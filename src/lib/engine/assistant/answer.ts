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
import { isExcludedFromTotals } from '@/lib/engine/transactions/exclude';
import {
  isSpendRow,
  spendContributionCents,
  type CategorySpend,
  type SpendingBreakdown,
} from '@/lib/engine/reports/reports';
import type { SpendingPlan, SpendingPlanDisclosures } from '@/lib/engine/spending-plan/plan';
import { reserveTermClause } from '@/lib/engine/spending-plan/reserves';
import { planRowLabels, uncountedFixedNote } from '@/lib/engine/spending-plan/row-labels';
import type { RecurringSummary } from '@/lib/engine/recurring/summary';
import type { Forecast } from '@/lib/engine/forecast/forecast';
import type { CashNeededResult } from '@/lib/engine/cash-needed/types';
import {
  type CardDuplicatePairInput,
  cardDuplicateAnswerNote,
  cardDuplicateUndatedNote,
} from '@/lib/engine/account/card-duplicate-view';
// U.16: the no-row-list variant of the handover-day sentence. Ask states a
// figure with nothing beneath it, so it cannot use the panel's wording.
import { handoverDayAnswerNote } from '@/lib/engine/glass-box/category-breakdown';
import {
  currentCycleAmountSource,
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
      ? // Number agreement holds for a MULTI-account fold (U.9): one live account may
        // continue more than one old row, and the singular read "X and Y was combined
        // into its connected account".
        foldedFrom.length === 1
        ? `${foldedFrom[0]} was combined into its connected account, so it counts once.`
        : `${foldedFrom.join(' and ')} were combined into their connected account, so it counts once.`
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

/**
 * O.19b: a capped category list rendered beneath a PERIOD TOTAL must state its
 * remainder, summed from the SAME array the total sums (the O.19 rule), so the
 * on-screen identity `listed facts + this line = the printed total` holds by
 * construction — the owner's /reports complaint ("these numbers do not add up")
 * applied to Ask's answers. Returns null when the list is complete: a remainder
 * line under a complete list would claim money that does not exist, and the
 * common short-list case must stay byte-identical.
 *
 * Untagged deliberately (no traceKey/cents): the tail is many categories, not
 * one trace group, so a tap could never reconcile it — plain text per the
 * ask-view fact gate.
 */
/** `null → []` so an absent remainder line spreads to nothing at the call sites. */
function listOrEmpty(fact: AssistantFact | null): AssistantFact[] {
  return fact === null ? [] : [fact];
}

function categoryRemainderFact(
  byCategory: CategorySpend[],
  shown: number,
  /** Set on the SCOPED answers (umbrella/group): a bare "Everything else" under
   *  "You spent $X on bills" reads as all NON-bills spending (critic P3) — the
   *  scope word pins the tail to the headline's own subject. */
  scopeLabel?: string,
): AssistantFact | null {
  if (byCategory.length <= shown) return null;
  const rest = byCategory.slice(shown);
  const restCents = rest.reduce((s, c) => s + c.amountCents, 0);
  return {
    label: `Everything else${scopeLabel ? ` in ${scopeLabel}` : ''} · ${rest.length} more categor${rest.length === 1 ? 'y' : 'ies'}`,
    value: fmt(restCents),
  };
}

export function answerSpendTotal(breakdown: SpendingBreakdown, tf: Timeframe): AssistantAnswer {
  if (breakdown.totalCents <= 0) {
    return { kind: 'spend_total', headline: `No spending recorded ${tf.label}.`, facts: [], source: REPORTS_SOURCE };
  }
  return {
    kind: 'spend_total',
    headline: `You spent ${fmt(breakdown.totalCents)} ${tf.label}.`,
    headlineCents: breakdown.totalCents,
    // Same correction as NET_SPEND_BASIS (O.7): the `credit-card-payment`
    // CATEGORY is not excluded by `isSpendRow` — only transfer-FLAGGED rows are.
    // C.26: the date rule is named because this sentence reads as the COMPLETE
    // rule, and a reader with a charge dated later this month is told about it
    // on /reports and would not be here. Unconditional, unlike the panel
    // sentence one module over: that one names an AMOUNT (a claim about this
    // reader's rows, so it is gated on there being one); this names a RULE,
    // which is true for every reader and every timeframe.
    // U.16: appended, never replacing — the rule sentence above is true for
    // every reader, and this clause is a fact about THIS reader's rows. The
    // empty branch above deliberately carries no note: it states no figure, and
    // a released day can only make a figure too high.
    detail:
      "Purchases only — transfers and income are excluded, and anything dated after today isn't counted yet." +
      (breakdown.countedOnHandoverDays > 0
        ? ` ${handoverDayAnswerNote(breakdown.countedOnHandoverDays)}`
        : ''),
    // Tagged (slice 2b): each top category is a trace group, so its figure is
    // independently tappable. traceKey/cents come from the SAME breakdown entry.
    // O.19b: the headline is the WHOLE period total, so the capped list carries
    // its remainder line (null → omitted when ≤3 categories exist).
    facts: [
      ...breakdown.byCategory
        .slice(0, 3)
        .map((c) => ({ label: c.name, value: fmt(c.amountCents), traceKey: c.categoryId, cents: c.amountCents })),
      ...listOrEmpty(categoryRemainderFact(breakdown.byCategory, 3)),
    ],
    source: REPORTS_SOURCE,
  };
}

export function answerSpendByCategory(breakdown: SpendingBreakdown, target: SpendTarget, tf: Timeframe): AssistantAnswer {
  let amount = 0;
  // U.16: accumulated from the SAME entries `amount` is summed from, in each of
  // the three branches — never `breakdown.countedOnHandoverDays`, which counts
  // every category and would claim a doubling inside a figure that may hold
  // none of it. A disclosure is scoped to the figure it qualifies.
  let handovers = 0;
  const facts: AssistantFact[] = [];
  if (target.type === 'category') {
    const hit = breakdown.byCategory.find((c) => c.categoryId === target.categoryId);
    amount = hit?.amountCents ?? 0;
    handovers = hit?.countedOnHandoverDays ?? 0;
  } else if (target.type === 'categories') {
    // Umbrella: sum the named leaves and surface the top 3 as the supporting facts.
    // byCategory is already amount-desc, so the filtered slice stays ranked.
    const ids = new Set(target.categoryIds);
    const matches = breakdown.byCategory.filter((c) => ids.has(c.categoryId));
    amount = matches.reduce((sum, c) => sum + c.amountCents, 0);
    handovers = matches.reduce((sum, c) => sum + c.countedOnHandoverDays, 0);
    // Tagged (slice 2b): each member category is a trace group when >1 are cited.
    for (const c of matches.slice(0, 3))
      facts.push({ label: c.name, value: fmt(c.amountCents), traceKey: c.categoryId, cents: c.amountCents });
    // O.19b: the headline sums EVERY matched leaf; a 4th+ leaf gets the
    // remainder line so the listed facts recompose the headline figure.
    facts.push(...listOrEmpty(categoryRemainderFact(matches, 3, target.label)));
  } else {
    const g = breakdown.byGroup.find((x) => x.group === target.group);
    amount = g?.amountCents ?? 0;
    handovers = (g?.categories ?? []).reduce((sum, c) => sum + c.countedOnHandoverDays, 0);
    for (const c of g?.categories.slice(0, 3) ?? [])
      facts.push({ label: c.name, value: fmt(c.amountCents), traceKey: c.categoryId, cents: c.amountCents });
    // O.19b: same identity for the group branch — `g.amountCents` sums all of
    // `g.categories`, of which only three are listed.
    facts.push(...listOrEmpty(categoryRemainderFact(g?.categories ?? [], 3, target.label)));
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
    // U.16: the share sentence is optional, so the note has to survive its
    // absence — a figure that can be counted twice must say so whether or not
    // it happens to have a percentage beside it.
    detail:
      [share ? `That's ${share} of your ${tf.label} spending.` : null, handovers > 0 ? handoverDayAnswerNote(handovers) : null]
        .filter((x): x is string => x !== null)
        .join(' ') || undefined,
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
    // U.16 (critic): this answer states TWO figures a released handover day can
    // inflate — the top category in the headline and the period total here — and
    // the first draft of the slice qualified neither, which is the exact silence
    // U.16 exists to remove. Both are covered by one sentence because both are
    // drawn from this breakdown: the total's count is the breakdown's, and the
    // top category is inside it. Scoped to the TOTAL's count, since that is the
    // figure this sentence sits beside.
    detail:
      `Total ${tf.label}: ${fmt(breakdown.totalCents)}.` +
      (breakdown.countedOnHandoverDays > 0
        ? ` ${handoverDayAnswerNote(breakdown.countedOnHandoverDays)}`
        : ''),
    // Tagged (slice 2b): every listed category rides in the trace as a reconciled
    // group, so each fact is independently tappable — including the non-top ones
    // the HEADLINE panel honestly hides (they don't sum to the tapped figure).
    // O.19b: `detail` prints the whole period total beside this capped list, so
    // the list carries its remainder line (omitted when the list is complete).
    facts: [
      ...top.map((c) => ({ label: c.name, value: fmt(c.amountCents), traceKey: c.categoryId, cents: c.amountCents })),
      ...listOrEmpty(categoryRemainderFact(breakdown.byCategory, limit)),
    ],
    source: REPORTS_SOURCE,
  };
}

// ─── largest purchases ──────────────────────────────────────────────────────

/**
 * One snapshot transaction in the shape Ask's merchant intents read, with a
 * canonical merchant derived once. Deliberately UNNARROWED — it is the whole
 * universe the snapshot handed us, and each consumer states its own narrowing.
 *
 * O.7: this used to be `PurchaseRow`, built by a POSTED-only `toPurchaseRows`,
 * and the name was the trap. `largestPurchases` NAMES a row as a settled fact
 * and must be POSTED-only; `merchantSpend` SUMS a window and (per O.6) must
 * count pending, because a pending charge has already reduced what you can
 * spend. Sharing one pre-narrowed builder silently gave the aggregate the
 * statement's rule, so Ask answered "at Whole Foods" on a different basis than
 * "on groceries" 25 lines away in the same switch. The builder is now universal
 * and the narrowings live at the two consumers.
 */
export interface AskTxnRow {
  /** DB row id, carried so a caller-supplied exclusion set (C.25 #403) can
   *  name exact rows. Absent only in hand-built fixtures. */
  id?: string;
  date: string;
  amountCents: number; // signed; negative = spend
  status: string; // PENDING | POSTED — narrowed by the consumer, never the builder
  /** The STORED category, verbatim. Null means unfiled — never silently relabelled. */
  categoryId: string | null;
  /**
   * The merchant table's mapping for this descriptor, CARRIED rather than merged
   * into `categoryId` (O.6's `TrendTxn.merchantCategoryId` precedent, DECISIONS
   * #327). Merging the two was an O.6 P0: `uncategorized` lives in the
   * `Transfers & Other` group, which `isPurchaseRow` rejects, so an unfiled
   * −$2,400 Chipotle row VANISHED from largest-purchases instead of being
   * labelled. Carrying them separately lets the row-NAMING consumer label a
   * known merchant while the SUMMING consumer buckets by the stored column,
   * which is what reconciles with the register.
   */
  merchantCategoryId: string | null;
  /**
   * True when `merchant` is an AGGREGATE pseudo-merchant — one canonical name
   * covering many unrelated payees (Zelle, Venmo, Check, Cash App, Apple Cash,
   * PayPal Transfer, ATM Withdrawal, Account Transfer, Card Payment, Unknown
   * Merchant). Mirrors `TrendTxn.aggregateMerchant`, straight from
   * `normalizeMerchant().aggregate`.
   *
   * REQUIRED, and carried for a reason both O.7 critics found independently.
   * The old `isPurchaseRow` rejected the whole `Transfers & Other` group, and
   * that exclusion was quietly doing a SECOND job: keeping merchant answers off
   * pseudo-merchants. `isSpendRow` — correctly, for a category figure — admits
   * that group, so moving `merchantSpend` onto it made Ask answer "You spent
   * $49.27 at ATM Withdrawal this month" on the demo seed, and net an Apple
   * Cash send against an Apple Cash receipt into "refunds exceeded purchases".
   * The basis change was right; the collateral guard had to be replaced by
   * name rather than inherited by accident.
   *
   * Note "Store Card Purchase" is deliberately NOT aggregate here — it is a
   * rule-eligible real merchant (trends.ts:87-89) — so it stays answerable.
   */
  aggregateMerchant: boolean;
  isTransfer?: boolean;
  isSplitParent?: boolean;
  /** O.15: reader-excluded rows leave every Ask figure via the one basis. */
  excludeFromTotals?: boolean | null;
  merchant: string;
}

/** A raw snapshot transaction as the assistant reads it. `categoryId` and
 *  `isSplitParent` are present on DB rows at runtime (declared here instead of
 *  re-cast at each call site — GLASSBOX_PLAN readiness note). */
export interface SnapshotTxnLike {
  /** Present on every snapshot row; optional for hand-built fixtures. */
  id?: string;
  date: string;
  amountCents: number;
  rawDescriptor: string;
  status: string;
  isTransfer: boolean;
  isSplitParent?: boolean;
  categoryId?: string | null;
  /** O.15: present on DB rows; carried so every Ask predicate can read it. */
  excludeFromTotals?: boolean | null;
}

/**
 * The snapshot rows with a canonical merchant attached — the shared input for
 * both merchant intents (largest_purchases + merchant_spend) AND the Glass-Box
 * trace, so all three read the same UNIVERSE and the trace can never cite rows
 * the answer did not see. (Moved from the server orchestrator for that lockstep.)
 *
 * It applies NO filter of its own. Every narrowing that used to live here now
 * lives at the consumer that needs it — see `AskTxnRow` for why.
 */
export function toAskTxnRows(txns: readonly SnapshotTxnLike[]): AskTxnRow[] {
  return txns.map((t) => {
    const m = normalizeMerchant(t.rawDescriptor);
    return {
      id: t.id,
      date: t.date,
      amountCents: t.amountCents,
      status: t.status,
      categoryId: t.categoryId ?? null,
      merchantCategoryId: m.categoryId ?? null,
      aggregateMerchant: m.aggregate,
      isTransfer: t.isTransfer,
      isSplitParent: t.isSplitParent ?? false,
      excludeFromTotals: t.excludeFromTotals ?? false,
      merchant: m.canonical,
    };
  });
}

/** The category a row-NAMING insight may label this row with: the stored column
 *  first, then the merchant table. Only the naming side resolves it this way —
 *  the summing side buckets by the stored column alone, because that is what the
 *  register and /reports bucket by. */
const namedCategoryId = (t: AskTxnRow): string => t.categoryId ?? t.merchantCategoryId ?? 'uncategorized';

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
function isPurchaseRow(t: AskTxnRow, meta: ReadonlyMap<string, CategoryMeta>): boolean {
  if (t.isSplitParent || t.isTransfer || isExcludedFromTotals(t)) return false;
  if (t.amountCents >= 0) return false;
  const id = namedCategoryId(t);
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
  rows: readonly AskTxnRow[],
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
  // C.25 (#403, critic P2-A): a carried-elsewhere loan payment is not a
  // purchase the reader can weigh — ranking it "biggest" beside totals that
  // dropped it would name as spending what every figure says is not.
  excludedFlowIds?: ReadonlySet<string>,
): LargestTxn[] {
  return rows
    .filter((t) => {
      if (typeof t.id === 'string' && excludedFlowIds?.has(t.id)) return false;
      const ym = t.date.slice(0, 7);
      return (
        // POSTED-only, and stated HERE rather than inherited from the row builder
        // (O.7). This sentence NAMES one row as a settled fact, so a provisional
        // amount makes it false rather than merely imprecise: a $1 fuel
        // pre-authorisation that later posts at $60 would be reported as the
        // purchase it is not. `merchantSpend` is an aggregate and deliberately
        // does NOT carry this line.
        t.status === 'POSTED' &&
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
      categoryName: meta.get(namedCategoryId(t))?.name ?? 'Uncategorized',
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
  /** NET spend: purchases less refunds, matching `spendingByCategory`. May be zero
   *  or negative when returns met or exceeded purchases — the caller must not read
   *  a non-positive value as "nothing happened here" (see `answerMerchantSpend`). */
  totalCents: number;
  /** Every COUNTED row — purchases AND refunds. Not a purchase count; see below.
   *  Excludes aggregate pseudo-merchant rows, which are reported separately. */
  count: number;
  purchaseCount: number;
  /** Gross purchases, positive. */
  purchaseCents: number;
  refundCount: number;
  /** Gross refunds, positive magnitude. `purchaseCents - refundCents === totalCents`. */
  refundCents: number;
  /** Pending money, split by direction — carried so the answer can state its own
   *  basis inline (O.6/L.29) instead of quietly counting unsettled rows. Split
   *  rather than netted because Plaid emits pending CREDITS, and a single netted
   *  figure made the copy call a pending refund a "pending charge". */
  pendingPurchaseCents: number;
  pendingRefundCents: number;
  /** Rows whose name matched but that are aggregate pseudo-merchants, so they are
   *  NOT counted (see `AskTxnRow.aggregateMerchant`). Non-zero with `count === 0`
   *  means "you asked about something that isn't a store" — a different fact from
   *  "you spent nothing there", and the answer says so rather than denying. */
  excludedAggregateCount: number;
  /** Matched rows left out by the C.25 loan-payment exclusion (#403, critic
   *  P1-C): the money matched the merchant and moved, but it is carried on a
   *  loan instead of in this answer's figures. Non-zero with `count === 0`
   *  means "you paid this lender, and that is not a purchase" — a different
   *  fact from "you spent nothing there", and the answer says so rather than
   *  denying. */
  excludedLoanPaymentCount: number;
  excludedLoanPaymentCents: number;
  /** Matched rows, contribution-desc then most-recent-first. SIGNED: a purchase is
   *  positive, a refund negative, so `items` always sums to `totalCents` — which is
   *  what the Glass-Box trace asserts at runtime. */
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
 * Sum one merchant's spending in [fromYm,toYm] up to `today`. Pure: rows in,
 * totals out — the server derives `rows` from the same snapshot every other
 * spending intent reads.
 *
 * BASIS (O.7 — changed deliberately, and this reverses #168 critic P2):
 * this is an AGGREGATE over a window, so it reads the SAME rows
 * `spendingByCategory` does, via that engine's own exported `isSpendRow` /
 * `spendContributionCents` rather than a predicate of its own. Concretely it
 * now counts PENDING rows and nets refunds, where it used to be POSTED-only
 * and gross.
 *
 * Why the reversal. #168 accepted "gross" on two stated grounds, and O.6
 * (DECISIONS #327) killed the load-bearing one: gross was said to match
 * "the sibling purchase surfaces and the /transactions activity list this
 * answer links to". The register's summary does print a gross **Money out**
 * tile, so that was not wrong — but it also prints **Net**, and O.5 established
 * that Net is the tile a category figure reconciles against. What actually
 * settles it is that Ask answers the same question two ways: "how much did I
 * spend on groceries this month" runs `spendingByCategory` (net, pending
 * included) and "how much did I spend at Whole Foods this month" ran this
 * function (gross, posted only) — same verb, same window, same reader, same
 * page, and if Whole Foods is the only grocer the two figures describe the
 * identical money. That is precisely the divergence O.6 unified everywhere
 * else, and this function is one consumer against five on the other basis, so
 * this one moves.
 *
 * `largestPurchases` deliberately does NOT move: it names a row as a settled
 * fact, and `isPurchaseRow`'s extra exclusions (the non-actionable group) exist
 * so an ATM withdrawal cannot win "your biggest purchase". Naming and summing
 * are now the two sides of O.6's rule rather than two callers of one narrowing.
 *
 * The `<= today` guard was the ONE divergence from `spendingByCategory` that
 * survived O.7, and C.26 closed it — in this function's favour. The argument
 * for it, written here first, is now the whole app's rule: "You spent" is a
 * claim about money already gone, and unlike a pending charge (committed,
 * merely not settled) a future-dated row has not moved at all. `SpendWindow`
 * carries the day for every other caller; this one still filters rows directly
 * because it takes rows, not a window, and the two now agree by argument rather
 * than differing by design. Stated in the answer's basis line either way.
 */
export function merchantSpend(
  rows: readonly AskTxnRow[],
  tf: Timeframe,
  query: string,
  today: string,
  meta: ReadonlyMap<string, CategoryMeta> = CATEGORY_BY_ID,
  // C.25 (#403, critic P1-2): the SAME loan-payment exclusion the category
  // intents apply — "how much did I spend at X" and "how much did I spend"
  // are one basis, and the stored-flag settlement flip must not survive on
  // this surface. A carried-elsewhere payment answers as not-spent.
  excludedFlowIds?: ReadonlySet<string>,
): MerchantSpendResult {
  const q = query.trim().toLowerCase();
  // `isSpendRow` carries the window itself; `<= today` and the merchant scope are ours.
  // Matched is computed WITHOUT the exclusion first, so the rows the
  // exclusion removes can still be COUNTED and disclosed (critic P1-C):
  // "no spending at your mortgage lender" is false — money moved there, it
  // is just carried on the loan instead of counted as spending.
  const matchedAll = rows.filter(
    (t) => t.date <= today && isSpendRow(t, tf, meta) && merchantMatches(t.merchant, q),
  );
  const named =
    excludedFlowIds === undefined
      ? matchedAll
      : matchedAll.filter((t) => !(typeof t.id === 'string' && excludedFlowIds.has(t.id)));
  const excludedLoanRows = matchedAll.length - named.length;
  const excludedLoanCents = named.length === matchedAll.length ? 0 : matchedAll
    .filter((t) => typeof t.id === 'string' && excludedFlowIds!.has(t.id))
    .reduce((s, t) => s + -Math.min(0, t.amountCents), 0);
  // The aggregate split, NOT part of the money basis: it decides which NAMES are
  // answerable as a store, never which rows belong to a category total. That is
  // why excluding them cannot make this figure disagree with /reports — no
  // category is called "ATM Withdrawal", so no reader can put the two side by side.
  const matched = named.filter((t) => !t.aggregateMerchant);
  const aggregateRows = named.filter((t) => t.aggregateMerchant);

  // Display name: the canonical form with the largest matched MAGNITUDE. Magnitude,
  // not net — a net-negative merchant (returns exceeded purchases) must still be
  // named properly, and on refund-free data the two rules pick the same string.
  // Falls back to the aggregate rows so the refusal below can name what it found
  // ("ATM Withdrawal") instead of echoing the reader's typed "atm".
  const byCanonical = new Map<string, number>();
  for (const t of matched.length > 0 ? matched : aggregateRows) {
    byCanonical.set(t.merchant, (byCanonical.get(t.merchant) ?? 0) + Math.abs(t.amountCents));
  }
  let display = '';
  let best = -1;
  for (const [name, amt] of byCanonical) {
    if (amt > best) {
      best = amt;
      display = name;
    }
  }

  let purchaseCount = 0;
  let purchaseCents = 0;
  let refundCount = 0;
  let refundCents = 0;
  let pendingPurchaseCents = 0;
  let pendingRefundCents = 0;
  for (const t of matched) {
    const c = spendContributionCents(t); // −amountCents: purchases positive, refunds negative
    // A ZERO row is neither. Banks post $0 verification holds (fuel, hotels), and
    // counting one as a purchase made the answer say "fully offset by refunds"
    // about a merchant with no refunds at all.
    if (c > 0) {
      purchaseCount += 1;
      purchaseCents += c;
      if (t.status === 'PENDING') pendingPurchaseCents += c;
    } else if (c < 0) {
      refundCount += 1;
      refundCents += -c;
      if (t.status === 'PENDING') pendingRefundCents += -c;
    }
  }

  const items = matched
    .map((t) => ({ date: t.date, merchant: t.merchant, amountCents: spendContributionCents(t) }))
    .sort((a, b) => b.amountCents - a.amountCents || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return {
    merchant: display || titleCaseTerm(query),
    totalCents: purchaseCents - refundCents,
    count: matched.length,
    purchaseCount,
    purchaseCents,
    refundCount,
    refundCents,
    pendingPurchaseCents,
    pendingRefundCents,
    excludedAggregateCount: aggregateRows.length,
    excludedLoanPaymentCount: excludedLoanRows,
    excludedLoanPaymentCents: excludedLoanCents,
    items,
  };
}

/** The pending clause, or '' — stated inline because O.6 made every surface that
 *  counts unsettled money say so (L.29: a figure names the basis it was summed on). */
function pendingClause(res: MerchantSpendResult): string {
  // Split by direction, because a pending row can move money either way (Plaid
  // emits pending credits) and calling a pending refund a "pending charge" would
  // be false. This clause is the sentence a reader trusts when the total
  // disagrees with their bank statement, so every word of it has to hold.
  const { pendingPurchaseCents: p, pendingRefundCents: r } = res;
  if (p > 0 && r > 0) return ` Includes ${fmt(p)} in pending charges and ${fmt(r)} in pending refunds.`;
  if (p > 0) return ` Includes ${fmt(p)} still pending.`;
  if (r > 0) return ` Includes ${fmt(r)} in pending refunds.`;
  return ''; // a $0 pending hold moves nothing and is not worth a sentence
}

/** Aggregate rows matched the name but were not counted — say so beside a figure
 *  they are absent from, or the reader reconciling against activity finds rows
 *  the total does not explain. */
function excludedAggregateClause(res: MerchantSpendResult): string {
  if (res.excludedAggregateCount === 0) return '';
  const n = res.excludedAggregateCount;
  return ` ${n} ${n === 1 ? 'row' : 'rows'} under a shared name like Zelle, Check or ATM ${n === 1 ? 'was' : 'were'} left out — those cover many payees.`;
}

/** C.25 (#403, critic P1-C): loan payments matched but carried elsewhere.
 *  O.18e-FU3: the tail is scoped to the answer's own figures — "not in these
 *  figures" — because "not as spending" was the universal the five surfaces
 *  already scoped away, and this clause sits beside figures that drop the
 *  rows. (The count-0 branches have no figures and say "counted on the loan
 *  instead" — see below.) */
function excludedLoanClause(res: MerchantSpendResult): string {
  if (res.excludedLoanPaymentCount === 0) return '';
  const n = res.excludedLoanPaymentCount;
  return ` ${fmt(res.excludedLoanPaymentCents)} in ${n === 1 ? 'a payment' : `${n} payments`} to this lender ${n === 1 ? 'is' : 'are'} counted on the loan, not in these figures.`;
}

export function answerMerchantSpend(res: MerchantSpendResult, tf: Timeframe): AssistantAnswer {
  const rowFacts: AssistantFact[] = res.items
    .slice(0, 5)
    .map((i) => ({ label: `${i.merchant} · ${humanDate(i.date)}`, value: fmt(i.amountCents) }));
  // O.19b: the headline figures are computed over ALL matched rows while this
  // list caps at five, so the tail gets a line summed from the same `items`
  // array (which sums to `totalCents` by contract). SIGNED deliberately: items
  // are contribution-desc, so the tail truncates refunds first (O.10c) and a
  // refund-heavy tail netting negative renders "-$X" — hiding the sign would
  // rebuild the bias this line exists to disclose. Omitted when complete.
  if (res.items.length > 5) {
    const rest = res.items.slice(5);
    const restCents = rest.reduce((s, i) => s + i.amountCents, 0);
    rowFacts.push({
      label: `${rest.length} more transaction${rest.length === 1 ? '' : 's'}`,
      value: fmt(restCents),
    });
  }

  // Five distinct facts, five sentences — never one shared "no spending" (L.29:
  // "you asked about a non-store", "nothing matched", "only $0 holds matched",
  // "everything came back" and "returns beat purchases" are different claims,
  // and the reader can only act on the one they are actually in).
  if (res.count === 0 && res.excludedAggregateCount > 0) {
    // The reader asked about a name that is not a store. Denying spending here
    // would be false — the money is real and sitting in their activity — but
    // totalling it under this name would invent a merchant. Say which it is.
    return {
      kind: 'merchant_spend',
      headline: `${res.merchant} isn't a single store, so there's no merchant total for it ${tf.label}.`,
      detail:
        'Cash withdrawals, transfers, checks and app-to-app payments all share one name like this, covering many different payees. Open activity to see the individual rows.',
      facts: [],
      source: ACTIVITY_SOURCE,
    };
  }

  if (res.count === 0 && res.excludedLoanPaymentCount > 0) {
    // C.25 (#403, critic P1-C): money DID move to this payee — it is carried
    // on a loan instead of in this answer. Denying it would be false (the rows
    // sit in the activity the source link opens); totalling it would count a
    // repayment as spending. Say which it is. The detail tail is deliberately
    // not "not as spending" (O.18e-FU3): the headline above already scopes the
    // claim to this month, and there is no figure here for a "not in these
    // figures" clause to name — "instead" points back at the headline.
    return {
      kind: 'merchant_spend',
      headline: `Payments to ${res.merchant} aren't counted as spending ${tf.label}.`,
      detail: `${fmt(res.excludedLoanPaymentCents)} went there${res.excludedLoanPaymentCount === 1 ? '' : ` across ${res.excludedLoanPaymentCount} payments`} — counted on the loan instead.`,
      facts: [],
      source: ACTIVITY_SOURCE,
    };
  }

  if (res.count === 0) {
    // Nothing matched at all. The only branch where "no spending" is true.
    return { kind: 'merchant_spend', headline: `No spending at ${res.merchant} ${tf.label}.`, facts: [], source: ACTIVITY_SOURCE };
  }

  if (res.purchaseCents === 0 && res.refundCents === 0) {
    // Only zero-amount rows (a $0 verification hold). Nothing moved, so "no
    // spending" is true — and the refund branches below would be false.
    // Unless loan payments moved (critic cycle 3 P2-1): then the lender DID
    // receive money, and denying spending without naming the payments is the
    // same false denial the dedicated branch above exists to prevent.
    if (res.excludedLoanPaymentCount > 0) {
      return {
        kind: 'merchant_spend',
        headline: `Payments to ${res.merchant} aren't counted as spending ${tf.label}.`,
        detail: `${fmt(res.excludedLoanPaymentCents)} went there${res.excludedLoanPaymentCount === 1 ? '' : ` across ${res.excludedLoanPaymentCount} payments`} — counted on the loan instead.`,
        facts: [],
        source: ACTIVITY_SOURCE,
      };
    }
    return { kind: 'merchant_spend', headline: `No spending at ${res.merchant} ${tf.label}.`, facts: [], source: ACTIVITY_SOURCE };
  }

  if (res.purchaseCents === 0) {
    // Refunds only — money moved, and it moved TOWARD the reader.
    return {
      kind: 'merchant_spend',
      headline: `No purchases at ${res.merchant} ${tf.label}.`,
      detail: `${fmt(res.refundCents)} came back in refunds.${pendingClause(res)}${excludedAggregateClause(res)}${excludedLoanClause(res)}`,
      facts: rowFacts,
      source: ACTIVITY_SOURCE,
    };
  }

  if (res.totalCents <= 0) {
    // Purchases exist but refunds met or beat them. `headlineCents` is deliberately
    // absent here and on every branch above.
    //
    // NOT because the rows could not reconcile — a critic checked, and they can:
    // `-totalCents` is exactly `-sum(items)`, so `assemble()` would return
    // `reconciled: true`. The reason is that `headlineCents` is what the UI makes
    // TAPPABLE, and the number printed in these sentences is a positive magnitude
    // of a NEGATIVE net. Tapping "$30.00" to open a panel headed "-$30.00" is a
    // reconciliation the reader cannot follow, which is the same contract read
    // one level up: never offer a tap we cannot honor.
    const bothFigures = `${fmt(res.purchaseCents)} spent, ${fmt(res.refundCents)} returned.${pendingClause(res)}${excludedAggregateClause(res)}${excludedLoanClause(res)}`;
    return {
      kind: 'merchant_spend',
      headline:
        res.totalCents === 0
          ? `Your purchases at ${res.merchant} ${tf.label} were fully offset by refunds.`
          : `Refunds at ${res.merchant} ${tf.label} exceeded purchases by ${fmt(-res.totalCents)}.`,
      detail: bothFigures,
      facts: rowFacts,
      source: ACTIVITY_SOURCE,
    };
  }

  const noun = res.purchaseCount === 1 ? 'purchase' : 'purchases';
  // With no refunds this is byte-identical to the pre-O.7 sentence, so every
  // refund-free golden holds; with refunds it names both figures, because the
  // headline is now a NET number and the listed rows are the purchases.
  const detail =
    res.refundCount > 0
      ? `Across ${res.purchaseCount} ${noun} totalling ${fmt(res.purchaseCents)}, less ${fmt(res.refundCents)} returned.${pendingClause(res)}${excludedAggregateClause(res)}${excludedLoanClause(res)}`
      : `Across ${res.purchaseCount} ${noun}.${pendingClause(res)}${excludedAggregateClause(res)}${excludedLoanClause(res)}`;
  return {
    kind: 'merchant_spend',
    headline: `You spent ${fmt(res.totalCents)} at ${res.merchant} ${tf.label}.`,
    headlineCents: res.totalCents,
    detail,
    facts: rowFacts,
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
    detail:
      "Income only — transfers between your own accounts are excluded, and anything dated after today isn't counted yet.",
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
  // Authored once for both surfaces that print these four lines (L.29). Before
  // this they were two copies, already drifted ('Savings target (Settings)' here
  // against '(from Settings)' in the trace), and neither said which kind of zero
  // a $0 line was. Ask carries no control, so an actionable zero's `action` is
  // dropped here — the label still names the missing input, and this answer's
  // source link opens the panel that offers it.
  const labels = planRowLabels(plan, disclosures);
  // Owner 2026-08-01: three-term formula only. Card payments settle spend; they
  // are answered under Cash needed, not as plan facts that must sum to the headline.
  const facts: AssistantFact[] = [
    { label: labels.income.label, value: fmt(plan.patternIncomeCents) },
    { label: labels.fixed.label, value: fmt(plan.fixedExpensesCents) },
    { label: labels.savings.label, value: fmt(plan.plannedSavingsCents) },
  ];
  // Each qualifier states its own DIRECTION, and states it for THE FIGURE THIS
  // BRANCH RENDERS (critic P1-1: the overspent branch shows the OVERAGE — the
  // negation of leftToSpend — so every "lower/higher" flips with it).
  // Directions never share a sentence (a-disclosure-is-several-claims lesson).
  const over = plan.overspent;
  const qualifiers: string[] = [];
  // A repeating bill the projection did not count (L.30). Ask needs this because
  // this answer is UNTRACED, so the /spending-plan basis list cannot reach a
  // reader who asked here. Authored in `row-labels.ts` with the labels; the
  // direction argument is this branch's own fact — `over` renders the OVERAGE, and
  // an uncounted bill makes an overage bigger where it makes room to spend smaller.
  const fixedShortfall = uncountedFixedNote(
    disclosures,
    over ? 'overage' : 'left-to-spend',
    'the fixed-expenses line',
  );
  if (fixedShortfall) qualifiers.push(fixedShortfall);
  if (
    disclosures.creditCardCount > 0 ||
    plan.cardObligationsCents !== 0 ||
    plan.obligationsBeyondMonthCents !== 0
  ) {
    qualifiers.push(
      'Card statement payments are not subtracted here — paying the card settles spending already counted. How much cash you need for cards is answered under Cash needed on the dashboard.',
    );
  }
  // C.23/H.4 (copy critic P2): every basis sentence below enumerates what the
  // fixed term subtracts — "fixed and recurring expenses" — and a declared
  // reserve is neither. It rides the qualifier list rather than being spliced
  // into four branches, so the enumeration stays true for the readers it was
  // already true for and the new fact carries its own condition.
  const reserveClause = reserveTermClause(plan.reserveLines.length);
  if (reserveClause !== '') qualifiers.push(reserveClause);
  const withQualifiers = (base: string) => [base, ...qualifiers].join(' ');
  if (plan.overspent) {
    // The basis rides this branch too (cycle-2 critic: Ask has no breakdown page, and an
    // inflated one-month pattern UNDERSTATES the overage — the dangerous direction).
    const basis =
      plan.incomeBasis === 'user-set'
        ? 'That is the monthly income you set on the plan, minus fixed costs and your planned savings. '
        : plan.incomeBasis === 'trailing-median'
        ? `That is the median of your last ${plan.incomeMonths} complete month${plan.incomeMonths === 1 ? '' : 's'} of earned pay in the checking account that pays your cards, minus fixed and recurring expenses and your planned savings. Investment income, interest, and money moved in from savings are left out. ${
            plan.incomeMonths >= 3
              ? ''
              : 'With fewer than three complete months behind it, a one-time deposit can still count — the real overage may be smaller as the pattern steadies. '
          }`
        : plan.incomeBasis === 'detected-series'
          ? 'That is your detected recurring income at a monthly rate, minus fixed and recurring expenses and your planned savings. A deposit on a rhythm longer than monthly — quarterly, twice a year, or yearly — is not counted here — one long gap is not enough to say when the next one lands, and counting money that may not arrive would make this figure too big. Your recurring list shows such a deposit at a share of a month; this figure leaves it out. '
          : 'There is no income pattern yet — no income has been detected. ';
    return {
      kind: 'safe_to_spend',
      headline: `You're ${fmt(-plan.leftToSpendCents)} over your plan for this month.`,
      detail: withQualifiers(
        `${basis}Discretionary spending is never subtracted — guilt-free is the month’s allocation, not what is left of it today.`,
      ),
      facts,
      source,
    };
  }
  return {
    kind: 'safe_to_spend',
    headline: `Your guilt-free allocation this month is ${fmt(plan.leftToSpendCents)}.`,
    detail: withQualifiers(
      plan.incomeBasis === 'user-set'
        ? 'That is the monthly income you set on the plan, minus fixed costs and your planned savings. Discretionary spending is never subtracted.'
        : plan.incomeBasis === 'trailing-median'
        ? `That is the median of your last ${plan.incomeMonths} complete month${plan.incomeMonths === 1 ? '' : 's'} of earned pay in the checking account that pays your cards, minus fixed and recurring expenses and your planned savings. Investment income, interest, and money moved in from savings are left out. ${
            plan.incomeMonths >= 3
              ? 'A one-time deposit is not income here — the median ignores the month it landed in.'
              : 'With fewer than three complete months behind it, a one-time deposit can still count — the pattern steadies as the third month arrives.'
          } Discretionary spending is never subtracted.`
        : plan.incomeBasis === 'detected-series'
          ? 'That is your detected recurring income at a monthly rate, minus fixed and recurring expenses and your planned savings. A deposit on a rhythm longer than monthly — quarterly, twice a year, or yearly — is not counted here — one long gap is not enough to say when the next one lands, and counting money that may not arrive would make this figure too big. Your recurring list shows such a deposit at a share of a month; this figure leaves it out.'
          : 'There is no income pattern yet — no income has been detected. Once a complete month of income posts, the figure comes from that pattern.',
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
            amountSource: currentCycleAmountSource(c.isEstimated),
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
    // Sufficient is not needed-by-then (L.23): when the window's worst dip lands after
    // the first short date, the single instruction above overstates what that date
    // requires. "Covers", not "is needed" (critic P2-2): the step figure rounds UP to
    // the next $50. Offered only when the engine proved the two-step plan sound (P1-1).
    if (
      s.firstShortCents > 0 &&
      s.firstShortCents < s.recommendation.amountCents &&
      s.worstDipDate
    ) {
      detailParts.push(
        `Two steps work: ${fmt(s.firstShortCents)} by ${humanDate(s.recommendation.byDate)} covers the first short day — the rest is for the low point on ${humanDate(s.worstDipDate)}.`,
      );
    }
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
    // audit P2: dated with the FIRST due — the earliest payment draws first.
    headline: `You need ${fmt(s.requiredCents)}${s.firstDueDate ? ` by ${humanDate(s.firstDueDate)}` : ''} to pay ${undated.length > 0 ? 'the cards I can date' : 'your cards'} in full.`,
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
  return ` Your savings target in Settings already sets aside ${fmt(unallocatedSavingsCents)} of your monthly income pattern that isn't committed to a named goal — ${covers ? 'this monthly amount can come out of that reserve first' : `the first ${fmt(unallocatedSavingsCents)} of this monthly amount can come out of that reserve`}.`;
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
  const facts: AssistantFact[] = summary.subscriptions
    .slice(0, 5)
    .map((s) => ({ label: s.merchantCanonical, value: `${fmt(s.monthlyEquivalentCents)}/mo` }));
  // O.19b: the headline totals ALL active subscriptions while this list caps at
  // five, so the tail gets its own line from the same array the headline sums —
  // omitted when the list is complete, keeping the ≤5 case byte-identical.
  if (summary.subscriptions.length > 5) {
    const rest = summary.subscriptions.slice(5);
    const restMonthlyCents = rest.reduce((a, s) => a + s.monthlyEquivalentCents, 0);
    facts.push({
      label: `Everything else · ${rest.length} more subscription${rest.length === 1 ? '' : 's'}`,
      value: `${fmt(restMonthlyCents)}/mo`,
    });
  }
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
