'use server';

/**
 * Ask Aimplifi — server orchestrator (DECISIONS #75). Parses the question to a
 * typed intent (deterministic; an optional, rate-limited LLM only disambiguates a
 * genuinely unknown phrasing into a KIND), then answers it from the SAME snapshot
 * + tested engines/read-paths the dedicated views use — so the assistant can never
 * originate a number or drift from /reports, /coach, /trends, etc. Ownership-scoped
 * via requireUserId; works fully with zero credentials (no LLM key → deterministic
 * routing + answers).
 */
import { requireUserId, rateLimitDurable } from '@/server/authz';
import { prisma } from '@/lib/db';
import { getProvider } from '@/lib/providers/demo';
import { resolvePaymentAccount, getCashNeeded } from '@/server/finance';
import { getSpendingPlan } from '@/server/spending-plan';
import { getRecurring } from '@/server/recurring';
import { getCashFlowForecast } from '@/server/forecast';
import { getCoachData } from '@/server/coach';
import { loadDebtAccounts } from '@/server/debt';
import { planDebtPayoff } from '@/lib/engine/debt/payoff';
import { solveDebtFreeByDate } from '@/lib/engine/solve/debt-free-by-date';
import { solveSavingsGoalByDate } from '@/lib/engine/solve/savings-goal-by-date';
import { solveRetireAtAge } from '@/lib/engine/solve/retire-at-age';
import { RETIREMENT_ASSUMPTIONS } from '@/lib/engine/investments/retirement';
import type { ISODate } from '@/lib/dates';
import { spendingByCategory, type ReportTxn } from '@/lib/engine/reports/reports';
import { monthlyFlows } from '@/lib/engine/fi/insights';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { mergeCategoryMeta, type CategoryMeta, type CustomCategoryInput } from '@/lib/engine/categorize/categories';
import { getCustomCategories } from '@/server/category-meta';
import { parseAssistantQuery, validateIntent, type AssistantIntent } from '@/lib/engine/assistant/intent';
import { followUpQuestions } from '@/lib/engine/assistant/follow-ups';
import { intentFromKind } from '@/lib/engine/assistant/llm';
import { classifyIntentViaLLM } from '@/server/assistant-llm';
import { recordUnknownQuestion } from '@/server/unknown-questions';
import {
  answerAccountBalance,
  answerCashNeeded,
  answerDebtFreeByDate,
  answerDebtPayoff,
  answerForecast,
  answerIncome,
  answerLargest,
  answerMerchantSpend,
  answerNetWorth,
  answerRetireAtAge,
  answerSafeToSpend,
  answerSavingsGoalByDate,
  answerSavingsGoalNeedsAmount,
  answerSavingsRate,
  answerSpendByCategory,
  answerSpendTotal,
  answerSubscriptions,
  answerTopCategories,
  answerUnknown,
  largestPurchases,
  merchantSpend,
  type AssistantAnswer,
  type PurchaseRow,
} from '@/lib/engine/assistant/answer';

const MONTH_TITLE = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ymLabel = (ym: string) => `${MONTH_TITLE[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/** Defensive bound on the question placed in a prompt / parsed (cheap DoS guard). */
const MAX_QUESTION_LEN = 500;
/** Per-user budget on the outbound LLM classifier (cost-amplification guard). */
const LLM_RATE_LIMIT = 30;
const LLM_RATE_WINDOW_MS = 60_000;

type ResolveResult = {
  intent: AssistantIntent;
  viaLlm: boolean;
  /** True when the deterministic parser returned `unknown` (ledger write gate). */
  parserUnknown: boolean;
  /** Raw LLM kind before validation; null if the classifier was not called. */
  llmGuessKind: string | null;
};

/**
 * Resolve the typed intent, escalating a deterministic `unknown` to the LLM
 * classifier only when a provider key is present AND the per-user LLM budget
 * allows — re-deriving every parameter deterministically and re-validating the
 * model's choice before any data is touched. Reports whether the LLM was used so
 * the answer can disclose it was an interpretation. Parser-unknown outcomes
 * (rescued or not) feed the UnknownQuestion ledger (TASKS 2.2).
 */
async function resolveIntent(
  question: string,
  today: string,
  userId: string,
  custom: readonly CustomCategoryInput[],
): Promise<ResolveResult> {
  const parsed = parseAssistantQuery(question, today as Parameters<typeof parseAssistantQuery>[1], custom);
  if (parsed.kind !== 'unknown') {
    return { intent: parsed, viaLlm: false, parserUnknown: false, llmGuessKind: null };
  }
  if (!process.env.XAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return { intent: parsed, viaLlm: false, parserUnknown: true, llmGuessKind: null };
  }
  if (!(await rateLimitDurable(`assistant-llm:${userId}`, LLM_RATE_LIMIT, LLM_RATE_WINDOW_MS))) {
    return { intent: parsed, viaLlm: false, parserUnknown: true, llmGuessKind: null };
  }

  const kind = await classifyIntentViaLLM(question);
  const proposed = intentFromKind(kind, question, today as Parameters<typeof intentFromKind>[2]);
  const valid = proposed ? validateIntent(proposed, custom) : null;
  return valid
    ? { intent: valid, viaLlm: true, parserUnknown: true, llmGuessKind: kind }
    : { intent: parsed, viaLlm: false, parserUnknown: true, llmGuessKind: kind };
}

export async function askAssistant(rawQuestion: string): Promise<AssistantAnswer> {
  const userId = await requireUserId();
  const question = (rawQuestion ?? '').trim().slice(0, MAX_QUESTION_LEN);
  const provider = getProvider();
  const today = provider.today(userId);
  // Custom categories (DECISIONS #111): the parser matches their names ("spend on
  // Golf"), and the merged meta makes the spend answers resolve them correctly.
  const custom = await getCustomCategories(userId);
  const meta = mergeCategoryMeta(custom);
  const { intent, viaLlm, parserUnknown, llmGuessKind } = await resolveIntent(
    question,
    today,
    userId,
    custom,
  );
  // Vocabulary mining (TASKS 2.2): every parser-unknown Ask, including LLM
  // rescues. Awaited so a fault is contained inside recordUnknownQuestion; never
  // aborts the answer. Deterministic routes write nothing.
  if (parserUnknown) {
    await recordUnknownQuestion({
      userId,
      rawQuestion: question,
      llmGuessKind,
      resolvedIntent: intent.kind,
    });
  }

  // One snapshot read serves every "direct" intent; composed answers reuse the
  // shipped read-paths (which load the same snapshot) so they can't drift.
  const snap = await provider.getFinanceSnapshot(userId);

  const answer = await buildAnswer(intent, snap, userId, today, meta);
  // Contextual follow-up chips (TASKS 1.2 / #197): static intent→question map.
  // unknown already carries ASSISTANT_SUGGESTIONS from answerUnknown().
  const followUps = followUpQuestions(intent);
  const withChips =
    followUps.length > 0 ? { ...answer, suggestions: [...followUps] } : answer;
  return viaLlm ? { ...withChips, interpreted: true } : withChips;
}

type FinanceSnapshot = Awaited<ReturnType<ReturnType<typeof getProvider>['getFinanceSnapshot']>>;

/** POSTED-only purchase rows with a derived canonical merchant — the shared input
 *  for both merchant intents (largest_purchases + merchant_spend), so they read
 *  the same universe of purchases and can't diverge. */
function toPurchaseRows(snap: FinanceSnapshot): PurchaseRow[] {
  return snap.transactions
    .filter((t) => t.status === 'POSTED')
    .map((t) => {
      const m = normalizeMerchant(t.rawDescriptor);
      return {
        date: t.date,
        amountCents: t.amountCents,
        categoryId: (t as { categoryId?: string | null }).categoryId ?? m.categoryId,
        isTransfer: t.isTransfer,
        isSplitParent: (t as { isSplitParent?: boolean }).isSplitParent ?? false,
        merchant: m.canonical,
      };
    });
}

async function buildAnswer(
  intent: AssistantIntent,
  snap: FinanceSnapshot,
  userId: string,
  today: string,
  meta: ReadonlyMap<string, CategoryMeta>,
): Promise<AssistantAnswer> {
  switch (intent.kind) {
    case 'net_worth':
      return answerNetWorth(snap.accounts);
    case 'account_balance':
      return answerAccountBalance(snap.accounts, intent.query);
    case 'spend_total':
      // Exact /reports parity — pass the snapshot rows straight to the same engine.
      return answerSpendTotal(spendingByCategory(snap.transactions as ReportTxn[], intent.timeframe, meta), intent.timeframe);
    case 'spend_by_category':
      return answerSpendByCategory(spendingByCategory(snap.transactions as ReportTxn[], intent.timeframe, meta), intent.target, intent.timeframe);
    case 'top_categories':
      return answerTopCategories(spendingByCategory(snap.transactions as ReportTxn[], intent.timeframe, meta), intent.timeframe, intent.limit);
    case 'largest_purchases':
      // POSTED-only, mirroring /trends exactly (pending charges aren't "purchases").
      return answerLargest(largestPurchases(toPurchaseRows(snap), intent.timeframe, intent.limit, today, meta), intent.timeframe);
    case 'merchant_spend':
      // Same POSTED-only purchase rows as largest_purchases (shared builder so the
      // two merchant surfaces can't drift), summed for the one queried merchant.
      return answerMerchantSpend(merchantSpend(toPurchaseRows(snap), intent.timeframe, intent.merchant, today, meta), intent.timeframe);
    case 'income': {
      // Full snapshot rows (incl. categoryId + isSplitParent at runtime) → same as
      // /reports & /coach: refunds net against spend, split parents excluded.
      const flows = monthlyFlows(snap.transactions);
      const income = flows
        .filter((f) => f.month >= intent.timeframe.fromYm && f.month <= intent.timeframe.toYm)
        .reduce((s, f) => s + f.incomeCents, 0);
      return answerIncome(income, intent.timeframe);
    }
    case 'savings_rate': {
      // Delegate to the Coach read-path so the rate is byte-identical to /coach
      // (its currentRateBps = the most recent complete month's savingsRateBps).
      const coach = await getCoachData(userId);
      const last = coach.flows[coach.flows.length - 1];
      return answerSavingsRate({
        rateBps: coach.currentRateBps,
        incomeCents: last?.incomeCents ?? 0,
        expensesCents: last?.expensesCents ?? 0,
        monthLabel: last ? ymLabel(last.month) : '',
      });
    }
    case 'safe_to_spend':
      return answerSafeToSpend(await getSpendingPlan(userId));
    case 'cash_needed': {
      const { result } = await getCashNeeded(userId);
      return answerCashNeeded(result, resolvePaymentAccount(snap).name);
    }
    case 'debt_payoff': {
      // Same read-path + engine as the /goals planner (avalanche default, no extra)
      // so the answer can never drift from the dedicated view.
      const debts = await loadDebtAccounts(userId);
      const plan = planDebtPayoff({ debts, strategy: 'avalanche', extraMonthlyCents: 0 });
      return answerDebtPayoff(plan, today, debts.length);
    }
    case 'debt_free_by_date': {
      // Inverse planner: SAME debt read-path + safe-to-spend the dedicated views use, so
      // it can't drift from /goals or /spending-plan. The solver originates the figure;
      // the LLM (if it routed here) supplied only the KIND — the date was re-derived
      // deterministically (llm.intentFromKind → parseTargetDate).
      const debts = await loadDebtAccounts(userId);
      const plan = await getSpendingPlan(userId);
      const result = solveDebtFreeByDate({
        debts,
        strategy: 'avalanche',
        targetDate: intent.targetDate,
        today: today as ISODate,
        safeToSpendCents: plan.leftToSpendCents,
      });
      return answerDebtFreeByDate(result, intent.label, intent.targetDate, today);
    }
    case 'savings_goal_by_date': {
      // Inverse savings planner (DECISIONS #126): the user STATED the amount + date; we
      // re-derive the required monthly from the SAME getSpendingPlan safe-to-spend the
      // /spending-plan view uses (so it can't drift), with no investment growth (matching the
      // /goals funding timeline). A stated date with no amount → ASK, never invent a figure.
      if (intent.targetCents === null) return answerSavingsGoalNeedsAmount(intent.label);
      const plan = await getSpendingPlan(userId);
      const result = solveSavingsGoalByDate({
        goalAmountCents: intent.targetCents,
        currentSavingsCents: 0, // a fresh envelope, like createGoal (savedCents starts at 0)
        targetDate: intent.targetDate,
        today: today as ISODate,
        safeToSpendCents: plan.leftToSpendCents,
      });
      return answerSavingsGoalByDate(result, intent.label, intent.targetDate, today);
    }
    case 'retire_at_age': {
      // Inverse retirement planner (DECISIONS #131): the user STATED the age; we re-derive the
      // minimal monthly contribution that makes the portfolio last from the SAME grounded inputs
      // the /investments retirement outlook uses — getCoachData.fi (portfolio/savings/spend/return/
      // SWR, byte-identical to /coach) + the User planning dials (ages/inflation, ?? the documented
      // defaults) + getSpendingPlan safe-to-spend. The LLM (if it routed here) supplied only the
      // KIND — the age was re-derived deterministically (llm.intentFromKind → parseTargetAge).
      const [coach, planRow, plan] = await Promise.all([
        getCoachData(userId),
        prisma.user.findUnique({
          where: { id: userId },
          select: { currentAge: true, endAge: true, inflationBps: true },
        }),
        getSpendingPlan(userId),
      ]);
      const result = solveRetireAtAge({
        targetRetirementAge: intent.targetAge,
        currentPortfolioCents: coach.fi.portfolioCents,
        monthlyContributionCents: coach.fi.monthlySavingsCents,
        annualRetirementSpendingCents: coach.fi.annualExpensesCents,
        nominalReturnBps: coach.fi.expectedReturnBps,
        swrBps: coach.fi.swrBps,
        currentAge: planRow?.currentAge ?? RETIREMENT_ASSUMPTIONS.currentAge,
        endAge: planRow?.endAge ?? RETIREMENT_ASSUMPTIONS.endAge,
        inflationBps: planRow?.inflationBps ?? RETIREMENT_ASSUMPTIONS.inflationBps,
        safeToSpendCents: plan.leftToSpendCents,
      });
      return answerRetireAtAge(result, intent.label);
    }
    case 'subscriptions':
      return answerSubscriptions((await getRecurring(userId)).summary);
    case 'forecast': {
      const { forecast, accountName, horizonDays } = await getCashFlowForecast(userId);
      return answerForecast(forecast, accountName, horizonDays);
    }
    case 'unknown':
    default:
      return answerUnknown();
  }
}
