/**
 * FI Coach data assembly: provider snapshot → pure FI engines.
 * Definitions (stated in the UI as assumptions):
 *  - annual expenses = last 6 full months of non-transfer outflows × 2
 *  - monthly savings = average (income − expenses) over those months
 *  - portfolio = investment account balances
 *  - liquid (runway) = checking + savings balances
 */
import { isoDate, addMonthsClamped } from '@/lib/dates';
import { type Cents, cents, roundHalfAwayFromZero } from '@/lib/money';
import { cashNeededFromSnapshot, resolvePaymentAccount } from '@/server/finance';
import { detectRecurring } from '@/lib/engine/recurring/detect';
import { buildAutomationBlueprint, type BlueprintStep, type PayCadence } from '@/lib/engine/automation/blueprint';
import { coastFI, fiNumberCents, monthsToFI } from '@/lib/engine/fi/fi';
import {
  RETIREMENT_ASSUMPTIONS,
  isRealReturnFloored,
  realReturnBps,
} from '@/lib/engine/investments/retirement';
import {
  detectLifestyleCreep,
  findOpportunities,
  hoursOfWork,
  monthlyFlows,
  monthsOfRunway,
  type CreepResult,
  type MonthlyFlow,
  type Opportunity,
} from '@/lib/engine/fi/insights';
import {
  buildMonthFlowBreakdowns,
  type MonthFlowBreakdown,
} from '@/lib/engine/glass-box/month-flow-breakdown';
import { registerDisplayName } from '@/lib/engine/transactions/display-name';
import type { DiscretionaryCategorySpend } from '@/lib/engine/fi/discretionary-cuts';
import { averageDiscretionaryCategorySpend } from '@/lib/engine/fi/discretionary-spend';
import { categoryName } from '@/lib/engine/categorize/categories';
import { detectUnusualCharges, type UnusualCharge } from '@/lib/engine/anomaly/detect';
import { isExcludedFromTotals } from '@/lib/engine/transactions/exclude';
import {
  type OutstandingReimbursements,
  outstandingReimbursements,
} from '@/lib/engine/transactions/reimbursement';
import { incomePausesForFeed, type IncomePauseState } from '@/lib/engine/income/pause';
import { computeMoneySignature, type MoneySignature } from '@/lib/engine/fi/signature';
import { computeSavingsStreak, type SavingsStreakResult } from '@/lib/engine/fi/savings-streak';
import { computeCardClearedStreak, type CardClearedStreakResult } from '@/lib/engine/cards/cleared-streak';
import { computeNoCreepStreak, type NoCreepStreakResult } from '@/lib/engine/recurring/creep-streak';
import { getConfirmedIncomePauses } from '@/server/income-pause';
import { getRecurringOverrides } from '@/server/recurring-overrides';
import { generateMoneyReview, type MoneyReview } from '@/lib/engine/fi/coach-copy';
import { buildReviewCandidates, selectReview, type ReviewRole } from '@/lib/engine/fi/money-review';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { aiAuditSink } from '@/server/ai-audit';
import { orderReviewViaLLM } from './money-review-llm';
import { returnIsAppDefault } from '@/lib/engine/settings/dials';
import {
  composeMemoryDividend,
  type MemoryDividendRow,
} from '@/lib/engine/fi/memory-dividend';
import { dialDisplayNames } from '@/lib/engine/settings/money-dial-ids';
import { loadDialCatalog, resolvedMoneyDialIds } from '@/server/money-dials';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { formatISODate } from '@/lib/dates';
import { prisma } from '@/lib/db';
import { RESERVE_KIND } from '@/lib/engine/spending-plan/reserves';
import { getProvider } from '@/lib/providers/demo';
import { getCategoryMeta } from '@/server/category-meta';
import { loanPaymentBasisFacts, type LoanPaymentBasisFact } from '@/server/loan-payment-basis';
import { accountLabel } from '@/lib/engine/account/display-name';

export interface CoachData {
  today: string;
  flows: MonthlyFlow[]; // last 12 full months, ascending
  /**
   * The savings-rate streak and personal-best claim over ALL complete months. The
   * 12-month `flows` array is the CHART slice; a "personal best so far" computed
   * over it would be false when an older month beats the recent best (audit P2).
   */
  streak: SavingsStreakResult;
  currentRateBps: number | null;
  /**
   * C.25 (#403, critic P1-5): the loan payments the figures on this page do
   * NOT count — the savings rate, creep baseline, discretionary average and
   * the FI number all read flows the exclusion moved, so the page names what
   * left. Empty when nothing moved, and the page says nothing.
   */
  loanPaymentExclusions: readonly LoanPaymentBasisFact[];
  /**
   * The rows behind each bar of the savings-rate chart, keyed `YYYY-MM:income`
   * and `YYYY-MM:expense` — the same builder and the same keys /reports uses
   * under its income-vs-spending chart.
   *
   * Owner request, 2026-08-02: *"if i want to know why and where cash come from
   * that caused greater savings for a specific month, i should be able to click
   * on the graph itself"*. A savings rate is a ratio of two figures and has no
   * rows of its own, so what a bar expands into is its NUMERATOR's two halves:
   * the income counted that month and the spending counted that month.
   *
   * Built from `txns` — the very array `monthlyFlows` summed — with `flows` as
   * the headlines, so each panel reconciles against the figure this page
   * actually rendered rather than a second derivation of it. Only the 12 months
   * the chart draws are keyed; nothing else is queried.
   */
  monthFlows: Record<string, MonthFlowBreakdown>;
  fi: {
    fiNumberCents: Cents;
    annualExpensesCents: Cents;
    portfolioCents: Cents;
    monthlySavingsCents: Cents;
    /**
     * How many months `monthlySavingsCents` and `monthlyIncomeCents` were actually averaged
     * over — `last6.length`, which is the DIVISOR, not the constant 6. C.9 (#405): this is
     * ALSO the window `annualExpensesCents` was scaled to a year from (same array, same
     * divisor), so every sentence that names the window — the FI number's "× 12/N", the
     * slider's "average pace", the runway's "average expenses" — reads this, never "6".
     *
     * Carried because two independent critics falsified the same sentence on the wealth-target
     * card: `monthlyFlows` emits only months that CONTAIN a qualifying row, so this is 3 for a
     * reader three months in and the span can cover eight calendar months when two are empty.
     * A surface that wants to say what window a figure came from has to be told; deriving "6"
     * from the name of the variable is how a checkable sentence became an uncheckable one.
     * 0 is a real value and means no complete month has any activity yet.
     */
    monthlySavingsMonths: number;
    monthlyIncomeCents: Cents;
    monthsToFI: number | null;
    coastIsCoast: boolean;
    coastRequiredMonthlyCents: Cents | null;
    swrBps: number;
    /** The reader's NOMINAL return dial (`User.expectedReturnBps`). Named in the copy as one
     *  operand of the real return; never itself the rate the FI projections compound at. */
    expectedReturnBps: number;
    /** W.13 — `expectedReturnBps` is still the app's `DEFAULT_EXPECTED_RETURN_BPS`, so the copy
     *  may not call it "your return assumption". Unlike `inflationIsDefault` this cannot be read
     *  off a null column (the column is non-nullable and the /settings field is required), so it
     *  is decided by value; `returnIsAppDefault` documents which direction that errs in. */
    returnIsDefault: boolean;
    /**
     * W.2 — the rate `monthsToFI`/`coastFI` above actually compounded at, and the rate the
     * card's slider must recompute with: `realReturnBps(expectedReturnBps, inflationBps)`.
     *
     * Carried rather than re-derived on the client because the slider calls the same engine,
     * and a component that re-derives its own rate is a second definition of the basis.
     */
    projectionReturnBps: number;
    inflationBps: number;
    /** `User.inflationBps` is nullable and this fell back to `RETIREMENT_ASSUMPTIONS` — so the
     *  copy may not call the rate "yours" (`an-answer-is-only-as-believable-as-its-visible-inputs`:
     *  a possessive is a claim). /settings calls the same 2.50% "our defaults". */
    inflationIsDefault: boolean;
    /** True when `projectionReturnBps` is the 0 FLOOR rather than the subtraction. The copy's
     *  floored branch may not print its operands. */
    realReturnFloored: boolean;
    /**
     * W.9 — the Coast horizon, and a number the APP picked, not the reader. Exposed with
     * `coastTargetYearsIsAppDefault` so the copy can say so: an unlabelled constant beside a
     * money figure reads as arbitrary, which was W.1a's whole finding one card down.
     */
    coastTargetYears: number;
    coastTargetYearsIsAppDefault: boolean;
  };
  opportunities: Opportunity[];
  /** Per-merchant median+MAD outliers (#249) — pure recompute, feeds the nudge feed. */
  unusualCharges: UnusualCharge[];
  /**
   * Lapsed recurring income series (#251) — pure recompute over the same detected
   * series, feeds the nudge feed. Unconfirmed lapses are news (recent only);
   * CONFIRMED pauses stay listed for as long as their projection exclusion is in
   * force, so the mutation is always visible and undoable.
   */
  incomePauses: IncomePauseState[];
  /**
   * Money Signature (#252): two habit axes with retrospective hysteresis + a
   * responsive "this month" weather state. Pure recompute over the FULL flow
   * history (not the 12-month display slice) — labels are a function of
   * history, never stored.
   */
  signature: MoneySignature;
  /**
   * Habit streaks (#254, AI plan §Later #17 streaks half): pure retrospective
   * walks — card statements cleared in full by their due date, and full months
   * without a subscription price increase. No persistence; recomputed from the
   * same snapshot statements/payments and the same detected `series`.
   */
  streaks: { cardCleared: CardClearedStreakResult; noCreep: NoCreepStreakResult };
  creep: CreepResult;
  runwayMonths: number;
  /**
   * Accounts whose bank stopped sharing them, split by WHICH figure on this page each one feeds
   * (TASKS L.18) — because the answer differs per figure and a page-wide banner would make claims
   * that are false of most of it:
   *
   *  · `portfolio` — the INVESTMENT rows summed into `fi.portfolioCents`, which drives months-to-FI,
   *    Coast FI and the slider.
   *  · `liquid` — the CHECKING/SAVINGS rows summed into the runway, which also drives the Money
   *    Signature's weather line.
   *
   * The FI NUMBER is deliberately absent from both, and this corrects the L.18 brief rather than
   * implementing it: `fiNumberCents(annualExpenses, swrBps)` reads no balance at all, so qualifying
   * it would attach a caveat to a figure the frozen account does not touch — the same over-claim the
   * L.15 cycle-2 critic caught one level down.
   *
   * Each list is built from the SAME filter as the sum it describes, minus superseded predecessors
   * (whose balances the reconciliation boundary has already zeroed — announcing one as "still
   * counted" is L.14's own critic P0-1).
   */
  frozenBalances: {
    portfolio: { label: string; frozenSince: string }[];
    liquid: { label: string; frozenSince: string }[];
  };
  lifeEnergy: {
    merchant: string;
    amountCents: number;
    hours: number;
    date: string;
    categoryId: string | null;
  }[];
  hourlyWageCents: number;
  /**
   * P2.2 memory-dividend row — same compose Ask phrases. The card
   * renders `line` only when `show` is true.
   */
  memoryDividend: MemoryDividendRow;
  /** Display names for coach copy (resolved from stored ids/names). */
  moneyDials: string[];
  /** Category ids for cut proposals — never names (O.17a). */
  moneyDialIds: string[];
  /**
   * Trailing average monthly discretionary spend by category (DECISIONS #375) —
   * cut-proposal input for the wealth-target card. Money dials are applied at
   * the proposal step, not here, so a dial change without a re-fetch of spends
   * still re-ranks correctly on the client.
   */
  discretionaryCategorySpend: DiscretionaryCategorySpend[];
  /** Settings savings-% dial — null when unset (Plan / wealth contribution). */
  savingsTargetBps: number | null;
  review: MoneyReview;
  /** §2.4 candidate-set recap shown on /coach — each line a verbatim COACH_COPY string. */
  reviewLines: { id: string; role: ReviewRole; line: string }[];
  /** True iff the LLM ordered the recap this render; false on the deterministic floor (demo/zero-key). */
  reviewPersonalized: boolean;
  blueprint: BlueprintStep[];
  /**
   * O.15: purchases the reader marked 'awaiting reimbursement' — count + the
   * verbatim sum of their magnitudes (the notify/select idiom: copied amounts,
   * nothing computed). Zero rows → {0, 0} and the card doesn't render.
   */
  outstandingReimbursements: OutstandingReimbursements;
}

/**
 * The Coast-FI horizon: "would what you have already invested grow into your FI number
 * within N years, with nothing added?"
 *
 * 25 is the APP'S pick — a conventional working-life span — and no control sets it. W.9
 * exists because it was printed in `COACH_COPY.notCoastFI` as bare fact ("over the next 25
 * years") beside a monthly dollar figure, with nothing distinguishing a number the app chose
 * from one the reader did. It is now labelled at the render site via
 * `coastTargetYearsIsAppDefault`.
 *
 * Deliberately NOT seeded from the reader's own arrival the way W.1a seeded the wealth card's
 * horizon: that card asks "when do I get there at my pace", so its own arrival is the honest
 * default, whereas Coast FI asks the opposite question — what happens if contributions STOP —
 * and seeding it from a pace that assumes contributions would make the horizon depend on the
 * very thing the question removes.
 */
const COAST_TARGET_YEARS = 25;

export async function getCoachData(
  userId: string,
  opts?: { orderReview?: boolean },
): Promise<CoachData> {
  const provider = getProvider();
  const today = provider.today(userId);
  const snap = await provider.getFinanceSnapshot(userId);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found');
  const [meta, dialCatalog] = await Promise.all([
    getCategoryMeta(userId), // custom-category aware creep (DECISIONS #111)
    loadDialCatalog(userId),
  ]);
  const moneyDialIds = resolvedMoneyDialIds(user.moneyDials, dialCatalog);
  // U.35: off the snapshot above, not a later `getReconciliationHandoverKeys`.
  // This page draws two transaction panels — the savings-rate chart's month
  // flows and the lifestyle-creep bars — and both tick "matched to the penny"
  // over rows a released day may have counted more than once.
  const handoverKeys = snap.handoverKeys;

  const txns = snap.transactions.map((t, i) => ({
    id: (t as { id?: string }).id ?? `txn-${i}`,
    date: t.date,
    amountCents: t.amountCents,
    rawDescriptor: t.rawDescriptor,
    // The register's own display rule, so one charge reads the same name in the
    // savings-rate panel as in the list it links to. Carried on THIS array —
    // the one `monthlyFlows` sums — rather than on a second mapping, for the
    // reason `getReports` states where it does the same thing: two panels that
    // disagree about a payee's name on one page would be a defect nobody could
    // explain, and building the array twice is what would let them.
    merchantName: registerDisplayName(t),
    accountId: t.accountId,
    isTransfer: t.isTransfer,
    status: t.status,
    isSplitParent: t.isSplitParent ?? false,
    categoryId: (t as { categoryId?: string | null }).categoryId ?? null,
    splitParentId: (t as { splitParentId?: string | null }).splitParentId ?? null,
    // O.15: carried so countsInFlows (and every coach sum below) drops
    // reader-excluded rows via the one basis.
    excludeFromTotals: t.excludeFromTotals ?? false,
    // O.15: carried for the outstanding-reimbursements line below.
    reimbursement: (t as { reimbursement?: string | null }).reimbursement ?? null,
  }));

  const allFlows = monthlyFlows(txns, snap.loanPaymentFlowExclusions?.excludeIds);
  const currentMonth = today.slice(0, 7);
  const fullFlows = allFlows.filter((f) => f.month < currentMonth);
  const flows = fullFlows.slice(-12);
  // Audit P2: streak + personal-best are FULL-HISTORY claims, computed over
  // `fullFlows`, never the chart slice — a "personal best so far" over the last
  // 12 months is false when an older month beats the recent best.
  const savingsStreak = computeSavingsStreak(fullFlows);
  // `flows` is the array the chart draws, so these headlines are the figures the
  // reader will actually see — `reconciles` is checked against the painted
  // numbers, not against a second derivation of them.
  const monthFlows = buildMonthFlowBreakdowns(txns, flows, snap.loanPaymentFlowExclusions?.excludeIds, null, handoverKeys);
  // C.25 (#403, critic P1-5): these figures MOVE when the exclusion applies
  // (savings rate, creep baseline, discretionary average, and the FI number
  // itself reads annual expenses off these flows) — so the page names what
  // left them, with the same one helper every other surface uses.
  const loanPaymentExclusions = loanPaymentBasisFacts(snap);
  const last6 = fullFlows.slice(-6);

  const expenses6 = last6.reduce((s, f) => s + f.expensesCents, 0);
  const income6 = last6.reduce((s, f) => s + f.incomeCents, 0);
  // C.9 (#405, audit P0-6): scale by the REAL window, not the constant 6. `expenses6 * 2`
  // assumed six months arrived, so a reader three months in got an annual figure that was
  // exactly half their true spending — and the FI number, the FI date, Coast and the /goals
  // emergency-fund example all halved with it. Same `Math.max(1, …)` guard the two averages
  // below use: with zero months the sum is 0 and the divisor cannot be 0.
  const annualExpenses = cents(
    roundHalfAwayFromZero((expenses6 * 12) / Math.max(1, last6.length)),
  );
  // documented rounding rule, not Math.round (half-toward-+∞ on negatives)
  const monthlySavings = roundHalfAwayFromZero((income6 - expenses6) / Math.max(1, last6.length));
  const monthlyIncome = roundHalfAwayFromZero(income6 / Math.max(1, last6.length));

  const portfolioAccounts = snap.accounts.filter((a) => a.type === 'INVESTMENT');
  const liquidAccounts = snap.accounts.filter(
    (a) => a.type === 'CHECKING' || a.type === 'SAVINGS',
  );
  const portfolio = cents(portfolioAccounts.reduce((s, a) => s + a.currentBalanceCents, 0));
  const liquid = cents(liquidAccounts.reduce((s, a) => s + a.currentBalanceCents, 0));
  // TASKS L.18 — read off the SAME two arrays the sums above are built from, so a disclosure can
  // never describe a set the figure does not contain. Superseded predecessors are dropped: the
  // boundary already zeroed their balances, so they are in neither sum, and saying otherwise is
  // exactly what L.14's critic P0-1 caught on the dashboard banner.
  const superseded = new Set(snap.supersededAccountIds ?? []);
  const frozenRows = (rows: typeof snap.accounts) =>
    rows
      .filter((a) => a.feedDroppedAt != null && !superseded.has(a.id))
      .map((a) => ({ label: accountLabel(a), frozenSince: a.feedDroppedAt as string }));
  const frozenBalances = {
    portfolio: frozenRows(portfolioAccounts),
    liquid: frozenRows(liquidAccounts),
  };

  // TASKS W.2 — the FI projections compound at the REAL (after-inflation) return, not the
  // nominal dial.
  //
  // `fiTarget` is a PRESENT VALUE: `annualExpenses` is this reader's actual spending over
  // their last ≤6 complete months scaled to a year, so the target is denominated in today's
  // dollars. Growing
  // the portfolio at the nominal 7% and stopping when it crosses that target compares future
  // nominal dollars against today's dollars — a unit mismatch, not a modelling choice, and it
  // runs optimistic by the whole inflation gap (decades on a long horizon). This card's own
  // sibling says so in `coach-copy.ts`: "a $10M answer at a nominal rate against a
  // present-value goal would be optimistic by decades."
  //
  // The two other surfaces answering this question already deflate — /investments'
  // `buildRetirementInputs` and W.1's wealth-target card — through this same shared helper, so
  // /coach now carries ONE basis rather than two. See DECISIONS #361 for the alternative that
  // was rejected (keep nominal growth and inflate the target instead): it is the larger change
  // and it yields a nominal FI number in future dollars, which is not a figure a reader can
  // hold their own spending up against.
  const inflationBps = user.inflationBps ?? RETIREMENT_ASSUMPTIONS.inflationBps;
  const projectionReturnBps = realReturnBps(user.expectedReturnBps, inflationBps);
  const fiTarget = fiNumberCents(annualExpenses, user.swrBps);
  const months = monthsToFI(portfolio, monthlySavings, projectionReturnBps, fiTarget);
  const coast = coastFI(portfolio, fiTarget, projectionReturnBps, COAST_TARGET_YEARS * 12);

  // Recurring detection universe = SPENDING accounts (checking/savings/credit), the
  // same universe getRecurring (#62) and refreshRecurringForUser read (#251 critic
  // F4: the feed's detector and the projection exclusion must read the SAME series —
  // a guard must read what it guards; previously this call alone detected over ALL
  // account types, so brokerage/loan-side rows could mint series the other two
  // consumers never see). Non-USD accounts are already withheld by the snapshot
  // itself (currency guard #135).
  const spendingIds = new Set(
    snap.accounts
      .filter((a) => (SPENDING_ACCOUNT_TYPES as readonly string[]).includes(a.type))
      .map((a) => a.id),
  );
  const series = detectRecurring(
    txns.filter((t) => t.status === 'POSTED' && !t.isSplitParent && spendingIds.has(t.accountId)),
    today,
    // O.13f: the same reader verdicts /recurring and the projections read. A coach
    // "you could cancel this subscription" about a series he has already told the
    // app is not a bill would be the app arguing with him from a stale basis.
    await getRecurringOverrides(userId),
  );
  // W.10 — BOTH dials, because these figures are grown at the return assumption and then
  // deflated by the inflation assumption. They render one scroll below the FI card that W.2
  // moved into today's money; printing 30-year NOMINAL future values beside it put two dollar
  // figures in two different units on one page with only the word "future" between them.
  const opportunities = findOpportunities(
    series,
    user.expectedReturnBps,
    inflationBps,
    moneyDialIds,
  );
  // Unusual Charge Radar (#249): pure detection over the SAME already-fetched rows —
  // no re-fetch, no model call, deterministic.
  const unusualCharges = detectUnusualCharges(txns, today);
  // Income-Pause Radar (#251): pure detection over the SAME detected series (POSTED,
  // non-split input — the sibling predicate), composed with the user's confirmations.
  // Unconfirmed lapses surface as news; a CONFIRMED pause stays listed (quietly) for
  // as long as its projection exclusion (server/recurring.ts) is in force, so the
  // mutation is always visible and undoable. Demo reads an empty confirmation set by
  // construction (the fence), so demo always sees the unconfirmed nudge.
  const confirmedPauses = await getConfirmedIncomePauses(userId);
  const incomePauses = incomePausesForFeed(series, today, confirmedPauses);
  const creep = detectLifestyleCreep(txns, today, 6, meta, snap.loanPaymentFlowExclusions?.excludeIds, handoverKeys);
  // documented rounding rule, not Math.round (consistency with monthlySavings above)
  const avgMonthlyExpenses = cents(roundHalfAwayFromZero(expenses6 / Math.max(1, last6.length)));
  const runway = monthsOfRunway(liquid, avgMonthlyExpenses);
  // Money Signature (#252) reads ALL flows (the engine drops the partial current
  // month itself and materializes calendar gaps) so the trailing-12-eligible
  // habit window sees the full history, not the 12-month display slice.
  const signature = computeMoneySignature(allFlows, { runwayMonths: runway, today });
  // Habit streaks (#254): pure walks over the SAME snapshot statements/payments
  // and the SAME detected series — no new queries, no persistence.
  const streaks = {
    cardCleared: computeCardClearedStreak(snap.statements, snap.cardPayments, today),
    noCreep: computeNoCreepStreak(series, today),
  };

  // life-energy view: 5 largest non-transfer purchases in the last 90 days
  const cutoff = addMonthsClamped(today, -3);
  const wage = user.hourlyWageCents ?? 0;
  const lifeEnergy = txns
    .filter(
      (t) =>
        !t.isTransfer &&
        !t.isSplitParent &&
        !isExcludedFromTotals(t) && // O.15: not the reader's spending
        // C.25 (#403): a loan payment carried elsewhere is not a drain the
        // reader can weigh — the committed line owns it.
        !(t.id !== undefined && snap.loanPaymentFlowExclusions?.excludeIds.has(t.id)) &&
        t.status === 'POSTED' &&
        t.amountCents < 0 &&
        t.date >= cutoff,
    )
    .sort((a, b) => a.amountCents - b.amountCents)
    .slice(0, 5)
    .map((t) => ({
      merchant: normalizeMerchant(t.rawDescriptor).canonical,
      amountCents: t.amountCents,
      hours: hoursOfWork(cents(t.amountCents), wage),
      date: t.date,
      categoryId: t.categoryId ?? null,
    }));
  const memoryDividendRow = composeMemoryDividend({
    items: lifeEnergy,
    moneyDialIds,
    meta,
  });

  // the Money Review's "one next action" prefers the live cash-needed remedy
  // (single shared assembly path — cycle-1 H1)
  const { result: cash } = cashNeededFromSnapshot(snap, today, 'PAY_IN_FULL');

  // Automation blueprint (P0.5): pay-yourself-first savings + card cash buffers,
  // phrased downstream as standing instructions to set up at the user's bank —
  // Aimplifi reminds, it never moves money (reminders/select.ts invariant).
  const goalRows = await prisma.goal.findMany({
    // Reserves (C.23/H.4) share this table and are a FIXED cost, not
    // pay-yourself-first savings: the blueprint's whole sentence is "set up a
    // standing transfer to savings for X", which is the wrong instruction for
    // money that is going to be spent on a roof. Excluded by kind rather than
    // by the null contribution a reserve happens to carry today — a data
    // convention is whatever the next writer decides it is.
    where: {
      userId,
    // NOT `kind: { not: RESERVE_KIND }`. SQL three-valued logic makes
    // `kind <> 'reserve'` NULL for a `kind IS NULL` row, and an ordinary
    // savings goal is exactly that — so the tidy-looking predicate silently
    // dropped EVERY savings goal (C.23 critic P0-1, executed: a three-goal
    // user saw one). The set this needs is "everything that is not a
    // reserve", and a null is not a reserve.
    OR: [{ kind: null }, { kind: { not: RESERVE_KIND } }],
    },
    select: { name: true, monthlyContributionCents: true },
  });
  // A CONFIRMED-paused income never anchors the blueprint (#251): telling the user to
  // automate savings around a paycheck the app itself agrees has stopped would be a
  // false plan. Unconfirmed lapses keep anchoring (the radar alone never mutates).
  // `incomePauses` already encodes confirmed ∧ lapsed (incomePausesForFeed keeps every
  // confirmed row exactly while its lapse — and so its exclusion — is in force).
  const confirmedPausedMerchants = new Set(
    incomePauses.filter((p) => p.confirmed).map((p) => p.merchantCanonical),
  );
  const topIncome = series
    .filter((s) => s.isIncome)
    .filter((s) => !confirmedPausedMerchants.has(s.merchantCanonical))
    .sort((a, b) => b.typicalAmountCents - a.typicalAmountCents)[0];
  const payCadence: PayCadence =
    topIncome &&
    (topIncome.cadence === 'WEEKLY' || topIncome.cadence === 'BIWEEKLY' || topIncome.cadence === 'MONTHLY')
      ? topIncome.cadence
      : null;
  const blueprint = buildAutomationBlueprint({
    paycheck: topIncome ? { cadence: payCadence, amountCents: topIncome.typicalAmountCents } : null,
    savings: goalRows
      .filter((g) => (g.monthlyContributionCents ?? 0) > 0)
      .map((g) => ({ name: g.name, monthlyCents: g.monthlyContributionCents as number })),
    cards: cash.cards.map((c) => ({
      cardName: c.cardName,
      dueDate: c.effectiveDueDate,
      cashRequiredCents: c.cashRequiredCents,
      // Estimated next-cycle obligations (no statement yet) are dropped by the
      // blueprint engine — a "set autopay to the statement balance" instruction
      // needs a real statement, and this matches the cash-needed headline (#98).
      isEstimated: c.isEstimated,
    })),
  });

  const pendingTransfer = cash.headline.recommendation
    ? {
        amountCents: cash.headline.recommendation.amountCents,
        byDate: formatISODate(isoDate(cash.headline.recommendation.byDate)),
        // TASKS L.18. The recommendation is the shortfall rounded up, and the shortfall is the gap
        // between the cards due and this account's balance — so when the bank has stopped sharing
        // the account, the amount is a floor rather than the answer. Labelled with the payment
        // account's own name, the same label /cards and the Ask answer print for it.
        // Named through the SAME resolver the engine used to pick the account (which applies the
        // reconciliation remap and the CHECKING fallback), never a guessed label — `snap
        // .paymentAccountId` can be null, and inventing "checking" for an account the reader calls
        // something else is a small fabrication in a sentence about trusting a number.
        frozenFunding: cash.fundingFrozen
          ? {
              label: accountLabel(resolvePaymentAccount(snap)),
              frozenSince: cash.fundingFrozen.frozenSince,
            }
          : null,
      }
    : null;
  // The 3-field object stays UNCHANGED — dashboard, return-moment, and the digest email
  // all consume it (AI plan §2.4: keep the incumbent surfaces untouched, blast-radius).
  const review = generateMoneyReview({ flows, creep, opportunities, runwayMonths: runway, pendingTransfer });

  // §2.4 candidate-set recap for the /coach card: the optional key-gated LLM only ORDERS a
  // closed set of ids; `selectReview` re-validates in-set, pins the material action, backfills
  // the deterministic floor, and the lines are rendered verbatim. The LLM ordering call is
  // gated to the /coach path (`opts.orderReview`) — every OTHER `getCoachData` caller (dashboard,
  // goals, investments, assistant, the per-user digest cron) gets the deterministic floor with
  // NO model call and no data egress (critic P1-1). No key / any failure → the floor (== `review`).
  // The recap's streak + personal-best candidates are FULL-HISTORY claims
  // (audit P2, critic P1): `savingsStreak` is computed over `fullFlows` above —
  // the SAME helper and the SAME basis the savings-rate card uses. Never pass
  // the 12-month chart slice, or the recap's "personal best so far" is false
  // when an older month beats the recent best and the two surfaces contradict.
  const reviewCandidates = buildReviewCandidates({ flows, streak: savingsStreak, creep, opportunities, runwayMonths: runway, pendingTransfer });
  // Demo fence (#242 critic P1-1, balance-move.ts precedent): the shared demo account
  // never consults a model — its recap is the deterministic floor by CONSTRUCTION,
  // never by env (this also removes the #241 P2 where the badge-absent e2e assumed a
  // keyless environment: demo is now floor-stable on ANY deployment).
  const reviewOrder =
    opts?.orderReview && userId !== DEMO_USER_ID
      ? await orderReviewViaLLM(reviewCandidates, aiAuditSink(userId, 'review_order')) // §3.2 trail
      : null;
  const reviewSelected = selectReview(reviewCandidates, reviewOrder);
  const reviewLines = reviewSelected.map((c) => ({ id: c.id, role: c.role, line: c.line }));
  // Honest badge: "Personalized" only when the LLM path actually CHANGED the recap vs the floor.
  const floorLines = selectReview(reviewCandidates, null);
  const reviewPersonalized =
    reviewOrder !== null &&
    reviewSelected.map((c) => c.line).join('\u0001') !== floorLines.map((c) => c.line).join('\u0001');

  return {
    today,
    flows,
    streak: savingsStreak,
    currentRateBps: flows[flows.length - 1]?.savingsRateBps ?? null,
    monthFlows,
    loanPaymentExclusions,
    fi: {
      fiNumberCents: fiTarget,
      annualExpensesCents: annualExpenses,
      portfolioCents: portfolio,
      monthlySavingsCents: monthlySavings,
      monthlySavingsMonths: last6.length,
      monthlyIncomeCents: monthlyIncome,
      monthsToFI: months,
      coastIsCoast: coast.isCoastFI,
      coastRequiredMonthlyCents: coast.requiredMonthlyContributionCents,
      swrBps: user.swrBps,
      expectedReturnBps: user.expectedReturnBps,
      projectionReturnBps,
      inflationBps,
      inflationIsDefault: user.inflationBps == null,
      returnIsDefault: returnIsAppDefault(user.expectedReturnBps),
      realReturnFloored: isRealReturnFloored(user.expectedReturnBps, inflationBps),
      coastTargetYears: COAST_TARGET_YEARS,
      // No control sets this today, so it is ALWAYS the app's pick. Kept as a field rather
      // than a literal `true` at the render site so that giving the reader a control later
      // changes one server line, not a copy branch that has quietly become false.
      coastTargetYearsIsAppDefault: true,
    },
    opportunities,
    unusualCharges,
    incomePauses,
    signature,
    streaks,
    creep,
    runwayMonths: runway,
    frozenBalances,
    lifeEnergy,
    hourlyWageCents: wage,
    memoryDividend: memoryDividendRow,
    moneyDials: dialDisplayNames(moneyDialIds, dialCatalog),
    moneyDialIds,
    discretionaryCategorySpend: averageDiscretionaryCategorySpend(
      txns,
      isoDate(today),
      3,
      meta,
      (id) => categoryName(id, meta),
      snap.loanPaymentFlowExclusions?.excludeIds,
    ),
    savingsTargetBps: user.savingsTargetBps ?? null,
    review,
    reviewLines,
    reviewPersonalized,
    blueprint,
    outstandingReimbursements: outstandingReimbursements(txns),
  };
}
