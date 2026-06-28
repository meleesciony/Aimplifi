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
import { getProvider } from '@/lib/providers/demo';
import { resolvePaymentAccount, getCashNeeded } from '@/server/finance';
import { getSpendingPlan } from '@/server/spending-plan';
import { getRecurring } from '@/server/recurring';
import { getCashFlowForecast } from '@/server/forecast';
import { getCoachData } from '@/server/coach';
import { loadDebtAccounts } from '@/server/debt';
import { planDebtPayoff } from '@/lib/engine/debt/payoff';
import { solveDebtFreeByDate } from '@/lib/engine/solve/debt-free-by-date';
import type { ISODate } from '@/lib/dates';
import { spendingByCategory, type ReportTxn } from '@/lib/engine/reports/reports';
import { monthlyFlows } from '@/lib/engine/fi/insights';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { mergeCategoryMeta, type CategoryMeta, type CustomCategoryInput } from '@/lib/engine/categorize/categories';
import { getCustomCategories } from '@/server/category-meta';
import { parseAssistantQuery, validateIntent, type AssistantIntent } from '@/lib/engine/assistant/intent';
import { intentFromKind } from '@/lib/engine/assistant/llm';
import { classifyIntentViaLLM } from '@/server/assistant-llm';
import {
  answerAccountBalance,
  answerCashNeeded,
  answerDebtFreeByDate,
  answerDebtPayoff,
  answerForecast,
  answerIncome,
  answerLargest,
  answerNetWorth,
  answerSafeToSpend,
  answerSavingsRate,
  answerSpendByCategory,
  answerSpendTotal,
  answerSubscriptions,
  answerTopCategories,
  answerUnknown,
  largestPurchases,
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

/**
 * Resolve the typed intent, escalating a deterministic `unknown` to the LLM
 * classifier only when a provider key is present AND the per-user LLM budget
 * allows — re-deriving every parameter deterministically and re-validating the
 * model's choice before any data is touched. Reports whether the LLM was used so
 * the answer can disclose it was an interpretation.
 */
async function resolveIntent(
  question: string,
  today: string,
  userId: string,
  custom: readonly CustomCategoryInput[],
): Promise<{ intent: AssistantIntent; viaLlm: boolean }> {
  const parsed = parseAssistantQuery(question, today as Parameters<typeof parseAssistantQuery>[1], custom);
  if (parsed.kind !== 'unknown') return { intent: parsed, viaLlm: false };
  if (!process.env.XAI_API_KEY && !process.env.ANTHROPIC_API_KEY) return { intent: parsed, viaLlm: false };
  if (!(await rateLimitDurable(`assistant-llm:${userId}`, LLM_RATE_LIMIT, LLM_RATE_WINDOW_MS))) return { intent: parsed, viaLlm: false };

  const kind = await classifyIntentViaLLM(question);
  const proposed = intentFromKind(kind, question, today as Parameters<typeof intentFromKind>[2]);
  const valid = proposed ? validateIntent(proposed, custom) : null;
  return valid ? { intent: valid, viaLlm: true } : { intent: parsed, viaLlm: false };
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
  const { intent, viaLlm } = await resolveIntent(question, today, userId, custom);

  // One snapshot read serves every "direct" intent; composed answers reuse the
  // shipped read-paths (which load the same snapshot) so they can't drift.
  const snap = await provider.getFinanceSnapshot(userId);

  const answer = await buildAnswer(intent, snap, userId, today, meta);
  return viaLlm ? { ...answer, interpreted: true } : answer;
}

async function buildAnswer(
  intent: AssistantIntent,
  snap: Awaited<ReturnType<ReturnType<typeof getProvider>['getFinanceSnapshot']>>,
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
    case 'largest_purchases': {
      // POSTED-only, mirroring /trends exactly (pending charges aren't "purchases").
      const rows: PurchaseRow[] = snap.transactions
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
      return answerLargest(largestPurchases(rows, intent.timeframe, intent.limit, today, meta), intent.timeframe);
    }
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
