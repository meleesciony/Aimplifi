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
import { getReconciliationBoundary } from '@/server/reconciliation';
import { prisma } from '@/lib/db';
import { getProvider } from '@/lib/providers/demo';
import { resolvePaymentAccount, getCashNeeded } from '@/server/finance';
import { getSpendingPlan } from '@/server/spending-plan';
import { getRecurring } from '@/server/recurring';
import { getCashFlowForecast } from '@/server/forecast';
import { getCashFlowRadar } from '@/server/radar';
import { getCoachData } from '@/server/coach';
import { composeStayingWealthy } from '@/lib/engine/fi/staying-wealthy';
import { loadDebtAccounts } from '@/server/debt';
import { planDebtPayoff } from '@/lib/engine/debt/payoff';
import { solveDebtFreeByDate } from '@/lib/engine/solve/debt-free-by-date';
import { solveSavingsGoalByDate } from '@/lib/engine/solve/savings-goal-by-date';
import { solveRetireAtAge } from '@/lib/engine/solve/retire-at-age';
import { seededHorizon, solveWealthTarget } from '@/lib/engine/solve/wealth-target';
import { wealthContributionBasis } from '@/lib/engine/fi/discretionary-cuts';
import { wealthTargetPlanUnproven } from '@/lib/engine/fi/coach-copy';
import { RETIREMENT_ASSUMPTIONS } from '@/lib/engine/investments/retirement';
import { type ISODate } from '@/lib/dates';
import { asOfWindow, spendingByCategory, type ReportTxn } from '@/lib/engine/reports/reports';
import { monthlyFlows } from '@/lib/engine/fi/insights';
import { askVocabulary, mergeCategoryMeta, type CategoryMeta } from '@/lib/engine/categorize/categories';
import { getCategoryOverlay } from '@/server/category-meta';
import { parseAssistantQuery, validateIntent, type AssistantIntent } from '@/lib/engine/assistant/intent';
import { frameFromIntent, resolveEllipsis, type AskFrame } from '@/lib/engine/assistant/frame';
import { followUpQuestions } from '@/lib/engine/assistant/follow-ups';
import { intentFromKind } from '@/lib/engine/assistant/llm';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { aiAuditSink } from '@/server/ai-audit';
import { classifyIntentViaLLM } from '@/server/assistant-llm';
import { recordUnknownQuestion } from '@/server/unknown-questions';
import { lookupVocab } from '@/server/vocab';
import type { VocabMatch } from '@/lib/engine/vocab/vocab';
import {
  answerAccountBalance,
  answerCashFlowRadar,
  answerCashNeeded,
  answerDebtFreeByDate,
  answerDebtPayoff,
  answerForecast,
  answerIncome,
  answerLargest,
  answerMerchantSpend,
  answerNetWorth,
  answerRetireAtAge,
  answerWealthTarget,
  answerWhatToCut,
  answerFiStatus,
  answerLifestyleCreep,
  answerRunway,
  answerConsciousSpending,
  answerStayWealthy,
  answerSafeToSpend,
  answerRichLife,
  answerSavingsGoalByDate,
  answerSavingsGoalNeedsAmount,
  answerSavingsRate,
  answerSpendByCategory,
  answerSpendTotal,
  answerSubscriptions,
  answerTopCategories,
  answerUnknown,
  assistantAccounts,
  largestPurchases,
  merchantSpend,
  toAskTxnRows as engineAskTxnRows,
  type AskTxnRow,
  type AssistantAnswer,
} from '@/lib/engine/assistant/answer';
import { ROW_SUM_KINDS, traceAnswer, type TraceTxn } from '@/lib/engine/assistant/trace';
import {
  traceCashNeededDerivation,
  traceNetWorthDerivation,
  traceSavingsRateDerivation,
} from '@/lib/engine/assistant/derivation';
import { CORRECTABLE_KINDS } from '@/lib/engine/assistant/trace-view';
import { applyCategory, undoCorrections } from '@/server/triage-actions';
import { accountLabel } from '@/lib/engine/account/display-name';
import { frozenTotalNote } from '@/lib/engine/account/feed-dropped-view';
import { loanPaymentBasisFacts, loanPaymentBasisSentence } from '@/server/loan-payment-basis';

const MONTH_TITLE = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ymLabel = (ym: string) => `${MONTH_TITLE[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/**
 * U.36: these intents only delegate to a loader that fetches its own boundary
 * (`getSpendingPlan`) or, for `savings_rate`, a snapshot that already carries
 * the keys (`getCoachData`). The composer views are unused — fetching them
 * here is a second snapshot of the same table, paid and discarded. Waste, not
 * a desync: each artifact stays internally consistent. Every other kind still
 * fetches eagerly (#466): a per-intent "does this spend case need keys?"
 * check is how a second spend case reintroduces the window.
 */
const DELEGATES_OWN_BOUNDARY: ReadonlySet<AssistantIntent['kind']> = new Set([
  'safe_to_spend',
  'debt_free_by_date',
  'savings_goal_by_date',
  'retire_at_age',
  'wealth_target',
  'savings_rate',
  'what_to_cut',
  'fi_status',
  'runway',
  'conscious_spending',
]);

const EMPTY_HANDOVER_KEYS: ReadonlySet<string> = new Set();
const EMPTY_TERMINAL_OF: ReadonlyMap<string, string> = new Map();

/** Defensive bound on the question placed in a prompt / parsed (cheap DoS guard). */
const MAX_QUESTION_LEN = 500;
/** Per-user budget on the outbound LLM classifier (cost-amplification guard). */
const LLM_RATE_LIMIT = 30;
const LLM_RATE_WINDOW_MS = 60_000;

type ResolveResult = {
  intent: AssistantIntent;
  viaLlm: boolean;
  /** True when the previous turn's frame resolved an ellipsis ("what about last
   *  month?") — deterministic, so it is NOT an LLM interpretation and NOT a
   *  vocabulary gap. */
  viaFrame: boolean;
  /** The learned phrase that routed this question, if any (TASKS 2.3). */
  vocab: VocabMatch | null;
  /** True when the deterministic parser returned `unknown` (ledger write gate). */
  parserUnknown: boolean;
  /** Raw LLM kind before validation; null if the classifier was not called. */
  llmGuessKind: string | null;
};

const NO_ROUTE = { viaLlm: false, viaFrame: false, vocab: null, parserUnknown: true } as const;

/**
 * Resolve the typed intent. Order is deterministic-first, by design:
 *   1. the parser (self-sufficient questions — never re-interpreted),
 *   2. the conversation frame (an ellipsis against the previous turn, TASKS 2.1),
 *   3. this user's LEARNED vocabulary (TASKS 2.3) — a phrasing they have asked
 *      repeatedly, which an independent resolver agreed on, promoted by the weekly
 *      miner. Deterministic and free, so it precedes the model call (and keeps
 *      working when no provider key is configured at all),
 *   4. the LLM classifier — only when a provider key is present AND the per-user
 *      LLM budget allows.
 *
 * Steps 3 and 4 are the SAME contract: they supply a KIND and nothing else. Every
 * parameter is re-derived from the user's own words by `intentFromKind` and
 * re-validated by `validateIntent` before any data is touched — so neither a model
 * nor a learned rule can inject a figure, a window, or a category. A learned kind
 * that cannot be re-derived falls through to the LLM rather than guessing.
 *
 * Reports how it routed so the answer can disclose the interpretation, and so the
 * UnknownQuestion ledger records what resolved each ask (TASKS 2.2).
 */
async function resolveIntent(
  question: string,
  today: string,
  userId: string,
  /** The reader's spoken vocabulary: custom categories PLUS renamed built-ins. */
  custom: readonly { id: string; name: string }[],
  frame: AskFrame | null,
): Promise<ResolveResult> {
  const parsed = parseAssistantQuery(question, today as Parameters<typeof parseAssistantQuery>[1], custom);
  if (parsed.kind !== 'unknown') {
    return { intent: parsed, viaLlm: false, viaFrame: false, vocab: null, parserUnknown: false, llmGuessKind: null };
  }
  const framed = resolveEllipsis(
    question,
    today as Parameters<typeof resolveEllipsis>[1],
    frame,
    custom,
  );
  if (framed) {
    return { intent: framed, viaLlm: false, viaFrame: true, vocab: null, parserUnknown: true, llmGuessKind: null };
  }

  const learned = await lookupVocab(userId, question);
  if (learned) {
    const proposed = intentFromKind(learned.kind, question, today as Parameters<typeof intentFromKind>[2], custom);
    const valid = proposed ? validateIntent(proposed, custom) : null;
    // The learned kind must ROUND-TRIP. The phrase key masks digits, so one key spans
    // "can I pay off my car by 2027" (a date) and "…by 65" (an age); `intentFromKind`
    // answers the second with a DIFFERENT kind — it silently degrades
    // debt_free_by_date to debt_payoff when no date parses (llm.ts). Down the LLM path
    // that is fine: the model read the actual question. Down this path nothing did —
    // the rule was learned from the OTHER form — so a kind swap means the words in
    // front of us are not the question this rule was mined from. Abstain: the LLM (or
    // the honest `unknown`) still gets its turn (#226 P2).
    //
    // A null re-derivation abstains for the same reason: a kind we cannot ground in
    // the user's own words is not an answer, it's a guess.
    if (valid && valid.kind === learned.kind) {
      return { intent: valid, viaLlm: false, viaFrame: false, vocab: learned, parserUnknown: true, llmGuessKind: null };
    }
  }

  // Demo fence (#242 critic P1-1, the balance-move.ts precedent): the demo account
  // is one SHARED row, so a demo visitor's typed question must never egress to a
  // provider — even on a keyed deployment. Demo Ask is deterministic by
  // construction: parser + frame + (empty-for-demo) vocab, then an honest unknown.
  if (userId === DEMO_USER_ID) {
    return { intent: parsed, ...NO_ROUTE, llmGuessKind: null };
  }
  if (!process.env.XAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return { intent: parsed, ...NO_ROUTE, llmGuessKind: null };
  }
  if (!(await rateLimitDurable(`assistant-llm:${userId}`, LLM_RATE_LIMIT, LLM_RATE_WINDOW_MS))) {
    return { intent: parsed, ...NO_ROUTE, llmGuessKind: null };
  }

  const kind = await classifyIntentViaLLM(question, aiAuditSink(userId, 'intent')); // Trust Center trail (§3.2, #242)
  const proposed = intentFromKind(kind, question, today as Parameters<typeof intentFromKind>[2], custom);
  const valid = proposed ? validateIntent(proposed, custom) : null;
  return valid
    ? { intent: valid, viaLlm: true, viaFrame: false, vocab: null, parserUnknown: true, llmGuessKind: kind }
    : { intent: parsed, ...NO_ROUTE, llmGuessKind: kind };
}

/**
 * Answer one question. `priorIntent` is the intent the PREVIOUS answer carried,
 * handed back by the client so a follow-up fragment can be resolved against it
 * (TASKS 2.1). It is untrusted client input, so it goes through the same
 * `validateIntent` gate the LLM's proposals do before it becomes a frame: a
 * malformed, hallucinated, or foreign-category intent simply yields no frame.
 * (Even a well-formed forged frame can only re-ask a question about the caller's
 * OWN snapshot — every read below is ownership-scoped.)
 */
export async function askAssistant(
  rawQuestion: string,
  priorIntent?: unknown,
): Promise<AssistantAnswer> {
  const userId = await requireUserId();
  const question = (rawQuestion ?? '').trim().slice(0, MAX_QUESTION_LEN);
  const provider = getProvider();
  const today = provider.today(userId);
  // Custom categories (DECISIONS #111): the parser matches their names ("spend on
  // Golf"), and the merged meta makes the spend answers resolve them correctly.
  const { custom, renames } = await getCategoryOverlay(userId);
  const meta = mergeCategoryMeta(custom, renames);
  // What the reader can SAY: their own categories plus any built-in they renamed.
  // The parser matched customs only, so a renamed built-in was unreachable by the
  // very name every other screen showed — Ask answered `unknown` for it.
  const spoken = askVocabulary(custom, renames);
  const validPrior = priorIntent == null ? null : validateIntent(priorIntent, spoken);
  const frame = validPrior ? frameFromIntent(validPrior) : null;
  const { intent, viaLlm, viaFrame, vocab, parserUnknown, llmGuessKind } = await resolveIntent(
    question,
    today,
    userId,
    spoken,
    frame,
  );
  // Vocabulary mining (TASKS 2.2): every parser-unknown Ask, including LLM
  // rescues AND frame-resolved ellipses. Awaited so a fault is contained inside
  // recordUnknownQuestion; never aborts the answer. Deterministic routes write
  // nothing.
  //
  // A frame-resolved row is tagged `frame:<kind>` rather than the bare kind: the
  // phrasing is CONTEXT-dependent ("what about last month?" means nothing on its
  // own), so the TASKS 2.3 miner must never promote it into a context-FREE vocab
  // rule — while the row itself still keeps a mis-resolution visible instead of
  // silently swallowing it. `resolvedIntent === 'unknown'` (the self-audit's
  // unknown-rate, TASKS 3.2) is unaffected either way.
  //
  // A row the LEARNED VOCABULARY resolved is tagged `vocab:<kind>` for the same
  // reason, inverted: the miner must never count its own answers as evidence FOR
  // itself (a flagged entry would then confirm itself forever). It counts them only
  // as `served`, and a bare kind therefore always means an INDEPENDENT resolution.
  if (parserUnknown) {
    const tag = viaFrame ? `frame:${intent.kind}` : vocab ? `vocab:${intent.kind}` : intent.kind;
    await recordUnknownQuestion({ userId, rawQuestion: question, llmGuessKind, resolvedIntent: tag });
  }

  const withFrame = await composeAnswer(userId, intent, today, meta);
  if (viaLlm) return { ...withFrame, interpreted: true };
  // A learned phrasing is never served silently (audit §4 constitution: every
  // adaptation is visible and undoable). At the `flagged` band it carries the SAME
  // "I interpreted your question" hedge an LLM answer does, because that is exactly
  // what it is — a provisional route, on trial. At `active` it is disclosed as
  // learned, with the same one-click undo.
  if (vocab) {
    return {
      ...withFrame,
      learned: { entryId: vocab.entryId, phrase: vocab.phrase, status: vocab.status },
      ...(vocab.status === 'flagged' ? { interpreted: true } : {}),
    };
  }
  return withFrame;
}

/**
 * Compose the full answer for a RESOLVED intent: one snapshot read → buildAnswer
 * → Glass-Box trace → follow-up chips → intent echo. Module-PRIVATE by design:
 * this file is 'use server', so an export would become a client-invokable
 * endpoint — and this helper trusts its arguments (a session-verified userId and
 * a validated intent). Shared by askAssistant and the slice-2b correction
 * re-dispatch, so a corrected answer is rebuilt by EXACTLY the pipeline that
 * built the original — and the LLM is bypassed by construction (the intent
 * arrives already resolved; routing flags like interpreted/learned are the
 * caller's concern).
 */
async function composeAnswer(
  userId: string,
  intent: AssistantIntent,
  today: string,
  meta: ReadonlyMap<string, CategoryMeta>,
): Promise<AssistantAnswer> {
  // One snapshot read serves every "direct" intent; composed answers reuse the
  // shipped read-paths (which load the same snapshot) so they can't drift.
  // U.34: the link table is read ONCE for this answer. `buildAnswer` used to
  // fetch handover keys in four spend cases and the links again for
  // account_balance, then this composer fetched the keys a fifth time for the
  // Glass-Box trace — so a spend_total's disclosure and the tick behind it
  // could resolve against two snapshots of the same table. Required on
  // `buildAnswer`, not optional: a fallback fetch is how the second read
  // survives unnoticed (U.33).
  // U.36: skip the composer boundary for intents that only delegate — those
  // loaders fetch their own, and the composer views are unused. Direct
  // intents still fetch in parallel with the snapshot.
  const skipComposerBoundary = DELEGATES_OWN_BOUNDARY.has(intent.kind);
  const [snap, { handoverKeys, terminalOf }] = await Promise.all([
    getProvider().getFinanceSnapshot(userId),
    skipComposerBoundary
      ? Promise.resolve({ handoverKeys: EMPTY_HANDOVER_KEYS, terminalOf: EMPTY_TERMINAL_OF })
      : getReconciliationBoundary(userId),
  ]);

  const built = await buildAnswer(intent, snap, userId, today, meta, handoverKeys, terminalOf);
  // C.25 (#403, critic P1-C): the flow totals behind these answers exclude
  // loan payments carried elsewhere — the answer says so, in the same words
  // every view uses, or Ask would print a figure no basis sentence owns.
  // O.18e-FU3: that sentence is the composer's 'answer' scope — a hand-rolled
  // copy here was the sixth phrasing of the fact and carried the old universal
  // tail ("not as spending") the five surfaces had already scoped away.
  // merchant_spend discloses in its own engine (it knows the merchant).
  const answer =
    intent.kind === 'spend_total' ||
    intent.kind === 'spend_by_category' ||
    intent.kind === 'top_categories' ||
    intent.kind === 'income' ||
    intent.kind === 'savings_rate'
      ? (() => {
          const facts = loanPaymentBasisFacts(snap);
          if (facts.length === 0) return built;
          const sentence = facts.map((e) => loanPaymentBasisSentence(e, 'answer')).join(' ');
          return { ...built, detail: built.detail ? `${built.detail} ${sentence}` : sentence };
        })()
      : built;
  // Glass-Box trace (GLASSBOX_PLAN slice 2): for a row-sum answer carrying a real
  // headline figure, re-select the exact transaction rows behind it — reconciled to
  // the penny by the SAME pure engines buildAnswer used, on the SAME snapshot + meta
  // — and attach it so the client can render the inline reconciliation panel.
  // `expectedHeadlineCents` is the builder's OWN figure (not the trace's), so a
  // builder/trace divergence is reported honestly (reconciled:false) rather than
  // green-checked next to a different number (critic 2026-07-15 F2). Derivation-chain
  // intents and empty results have no `headlineCents` → no trace → the figure stays
  // non-tappable (never offer a reconciliation we can't honor).
  const withTrace: AssistantAnswer =
    answer.headlineCents !== undefined && ROW_SUM_KINDS.has(intent.kind)
      ? {
          ...answer,
          trace: traceAnswer(intent, {
            transactions: snap.transactions as TraceTxn[],
            today,
            meta,
            expectedHeadlineCents: answer.headlineCents,
            // C.25 (#403): the trace re-selects the rows the answer summed —
            // it must drop the same loan-payment rows or a correct answer
            // would reconcile FALSE.
            excludedFlowIds: snap.loanPaymentFlowExclusions?.excludeIds,
            // U.16: the trace CERTIFIES the rows it cites with a green check, so
            // it is the one Ask surface where a released handover day must be
            // both marked on the row and named in the basis. Without this the
            // drilldown behind the answer's own disclosure shows two identical
            // lines under a tick and says nothing — the exact defect the
            // disclosure exists to remove, one tap away from it.
            handoverKeys,
          }),
        }
      : answer;
  // Contextual follow-up chips (TASKS 1.2 / #197): static intent→question map.
  // unknown already carries ASSISTANT_SUGGESTIONS from answerUnknown().
  const followUps = followUpQuestions(intent);
  const withChips =
    followUps.length > 0 ? { ...withTrace, suggestions: [...followUps] } : withTrace;
  // Echo the resolved intent so the next turn can swap one slot of it (TASKS 2.1).
  // `unknown` carries nothing — there is no frame to follow up on.
  return intent.kind === 'unknown' ? withChips : { ...withChips, intent };
}

/** Shared gate for the slice-2b correction actions: the intent is untrusted
 *  client input → validateIntent; and only the category-sum family
 *  (CORRECTABLE_KINDS) is accepted — the only intents whose UI offers the chip
 *  and whose figures a category correction visibly moves. */
function validatedCorrectionIntent(
  raw: unknown,
  /** The reader's spoken vocabulary: custom categories PLUS renamed built-ins. */
  custom: readonly { id: string; name: string }[],
): AssistantIntent {
  const intent = validateIntent(raw, custom);
  if (!intent || !CORRECTABLE_KINDS.has(intent.kind)) {
    throw new Error('This answer does not support corrections.');
  }
  return intent;
}

/**
 * Glass-Box slice 2b — the one-tap correction chip's write path.
 *
 * "This row should be <category>": records the correction through the SAME
 * proven triage action every other recategorization surface uses
 * (`applyCategory`: ownership-scoped, serializable transaction, append-only
 * Correction row, undoable), then re-answers the SAME resolved intent so the
 * user sees the figure move. Deliberate scope:
 *  - NEVER `always`: Ask mints no durable merchant rule. "This should be X" is
 *    a statement about ONE transaction; durable learning stays on /triage,
 *    where a rule's scope is shown and manageable. This is also the
 *    shared-demo-account fence that matters here — the correction itself is a
 *    category pick on shared seeded data (reversible, reseedable, no typed
 *    input: the same write /triage already allows the demo user), but Ask must
 *    never let a demo visitor DURABLY teach the shared account. (The
 *    typed-input fence lives in vocab.ts `learningDisabled` and is untouched.)
 *  - The LLM is bypassed by construction: the intent arrives already resolved
 *    and re-validated; no model call happens anywhere on this path.
 */
export async function correctFromAsk(input: {
  transactionId: string;
  toCategoryId: string;
  /** The answer's echoed resolved intent — untrusted, re-validated here. */
  intent: unknown;
}): Promise<{ answer: AssistantAnswer | null; correctionId: string }> {
  const userId = await requireUserId();
  const { custom, renames } = await getCategoryOverlay(userId);
  const intent = validatedCorrectionIntent(input.intent, askVocabulary(custom, renames));
  // Ownership, category validity (system or caller-owned custom), the
  // append-only Correction, and the audit log are all applyCategory's own
  // gates — reused verbatim so this surface can never drift from /triage.
  const { correctionIds } = await applyCategory({
    transactionId: input.transactionId,
    categoryId: input.toCategoryId,
  });
  // The write above is COMMITTED. A recompute failure past this point must not
  // masquerade as a failed correction (critic 2b F1): that would show a false
  // "try again" next to a now-stale green check, with the undo handle lost.
  // Return the correction handle with no answer; the client discloses the split
  // honestly (panels closed, undo offered, "ask again to refresh").
  try {
    const answer = await composeAnswer(userId, intent, getProvider().today(userId), mergeCategoryMeta(custom, renames));
    return { answer, correctionId: correctionIds[0] };
  } catch {
    return { answer: null, correctionId: correctionIds[0] };
  }
}

/**
 * Undo an Ask correction (slice 2b): the inverse Correction via the same triage
 * undo (owner-scoped, idempotent, restores the row to review — audit = state),
 * then re-answer the same resolved intent so the figure moves back. A forged or
 * foreign correctionId is a no-op inside undoCorrections (scoped to the caller),
 * so the recompute below is the worst a bad id can obtain.
 */
export async function undoAskCorrection(input: {
  correctionId: string;
  /** The answer's echoed resolved intent — untrusted, re-validated here. */
  intent: unknown;
}): Promise<{ answer: AssistantAnswer | null }> {
  const userId = await requireUserId();
  const { custom, renames } = await getCategoryOverlay(userId);
  const intent = validatedCorrectionIntent(input.intent, askVocabulary(custom, renames));
  await undoCorrections([input.correctionId]);
  // Same committed-write honesty as correctFromAsk (critic 2b F1): the undo is
  // durable and idempotent (a retried undo is a no-op), so a recompute failure
  // returns null rather than pretending the undo failed.
  try {
    const answer = await composeAnswer(userId, intent, getProvider().today(userId), mergeCategoryMeta(custom, renames));
    return { answer };
  } catch {
    return { answer: null };
  }
}

type FinanceSnapshot = Awaited<ReturnType<ReturnType<typeof getProvider>['getFinanceSnapshot']>>;

// The row builder lives in the answer engine (GLASSBOX_PLAN slice 1) so the
// merchant intents and the Glass-Box trace share one universe. It narrows
// nothing (O.7) — each intent below states its own basis.
const toAskTxnRows = (snap: FinanceSnapshot): AskTxnRow[] => engineAskTxnRows(snap.transactions);

async function buildAnswer(
  intent: AssistantIntent,
  snap: FinanceSnapshot,
  userId: string,
  today: string,
  meta: ReadonlyMap<string, CategoryMeta>,
  handoverKeys: ReadonlySet<string>,
  terminalOf: ReadonlyMap<string, string>,
): Promise<AssistantAnswer> {
  // TASKS L.18: one normalization of the snapshot rows into the assistant's shape, so every answer
  // and trace below sees `feedDroppedAt` and none of them can quote a frozen balance as a live one.
  const accounts = assistantAccounts(snap.accounts, new Set(snap.supersededAccountIds ?? []));
  // C.26: the reader's timeframe, stopping at today — the window the three
  // category intents sum over AND the one the Glass-Box trace cites rows with,
  // named once here so an answer and its own evidence cannot be selected
  // differently. `merchant_spend` has clamped since O.7 and is what made the
  // split visible: "how much did I spend at Whole Foods" already stopped at
  // today while "how much did I spend on groceries" did not.
  const askSpendWindow = (tf: { fromYm: string; toYm: string }) => asOfWindow(tf, today);
  switch (intent.kind) {
    case 'net_worth': {
      // Slice 3: derivation traces are attached HERE, where the engine inputs
      // are live (composeAnswer's row-sum attach recomputes from transactions,
      // which these formulas don't read). `headlineCents`/`headlineBps` is the
      // builder's own figure, so the trace's equality is a real drift gate.
      const answer = answerNetWorth(accounts);
      return answer.headlineCents === undefined
        ? answer
        : { ...answer, trace: traceNetWorthDerivation(accounts, answer.headlineCents) };
    }
    case 'account_balance':
      // Slice-6 critic C-5: fold a matched superseded predecessor onto its live successor —
      // the boundary zeroes the predecessor, so answering it raw said "$0.00" for a real,
      // funded account and counted one real account as two in type totals.
      return answerAccountBalance(
        accounts,
        intent.query,
        terminalOf,
      );
    case 'spend_total':
      // Exact /reports parity — pass the snapshot rows straight to the same
      // engine, with the same C.25 loan-payment exclusion (#403), and since
      // C.26 the same stop-at-today window (`askSpendWindow`), or Ask and
      // /reports would answer the same month differently.
      return answerSpendTotal(
        spendingByCategory(
          snap.transactions as ReportTxn[],
          askSpendWindow(intent.timeframe),
          meta,
          snap.loanPaymentFlowExclusions?.excludeIds,
          // U.16: this answer is a headline with no rows beneath it, so the
          // released handover day has to be nameable in the answer itself.
          // U.34: the set is the composer's, not a second fetch.
          handoverKeys,
        ),
        intent.timeframe,
      );
    case 'spend_by_category':
      return answerSpendByCategory(
        spendingByCategory(
          snap.transactions as ReportTxn[],
          askSpendWindow(intent.timeframe),
          meta,
          snap.loanPaymentFlowExclusions?.excludeIds,
          // U.16: this answer is a headline with no rows beneath it, so the
          // released handover day has to be nameable in the answer itself.
          handoverKeys,
        ),
        intent.target,
        intent.timeframe,
      );
    case 'top_categories':
      return answerTopCategories(
        spendingByCategory(
          snap.transactions as ReportTxn[],
          askSpendWindow(intent.timeframe),
          meta,
          snap.loanPaymentFlowExclusions?.excludeIds,
          // U.16: this answer is a headline with no rows beneath it, so the
          // released handover day has to be nameable in the answer itself.
          handoverKeys,
        ),
        intent.timeframe,
        intent.limit,
      );
    case 'largest_purchases':
      // NAMES a row as a settled fact ⇒ POSTED-only, applied inside
      // `largestPurchases` itself. See O.6's rule, and O.7 for why this is no
      // longer shared with `merchant_spend` below.
      // The optional merchant scope (TASKS 2.7) threads through verbatim.
      return answerLargest(
        largestPurchases(
          toAskTxnRows(snap),
          intent.timeframe,
          intent.limit,
          today,
          meta,
          intent.merchant,
          snap.loanPaymentFlowExclusions?.excludeIds,
        ),
        intent.timeframe,
        intent.merchant,
      );
    case 'merchant_spend':
      // SUMS a window ⇒ the same basis the three category intents above use
      // (`isSpendRow`: POSTED **and** PENDING, refunds netted, C.25 loan
      // payments carried elsewhere excluded — #403). O.7 moved it off
      // the purchase predicate so "how much did I spend at Whole Foods" and "how
      // much did I spend on groceries" cannot answer the same money differently.
      return answerMerchantSpend(
        merchantSpend(
          toAskTxnRows(snap),
          intent.timeframe,
          intent.merchant,
          today,
          meta,
          snap.loanPaymentFlowExclusions?.excludeIds,
          // U.20: the same account-scoped set the three category intents above
          // feed `spendingByCategory`. Without it this answer states a figure a
          // released day can double and says nothing, which is the silence U.16
          // removed from every other spend surface.
          handoverKeys,
        ),
        intent.timeframe,
      );
    case 'income': {
      // Full snapshot rows (incl. categoryId + isSplitParent at runtime) → same as
      // /reports & /coach: refunds net against spend, split parents excluded,
      // loan payments carried elsewhere left out (C.25 #403) — one basis.
      // C.26: "you brought in" is the income-side twin of "you spent", so it
      // stops at today the same way — a paycheck the reader has dated for next
      // Friday has not arrived. The three spending intents above clamp through
      // their window; `monthlyFlows` has no window parameter, so the same
      // narrowing is applied to its input, which for any past timeframe removes
      // nothing.
      const flows = monthlyFlows(
        snap.transactions.filter((t) => t.date <= today),
        snap.loanPaymentFlowExclusions?.excludeIds,
      );
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
      const answer = answerSavingsRate({
        rateBps: coach.currentRateBps,
        incomeCents: last?.incomeCents ?? 0,
        expensesCents: last?.expensesCents ?? 0,
        monthLabel: last ? ymLabel(last.month) : '',
      });
      // Slice 3: the trace RECOMPUTES the rate from the month's flows, while
      // `headlineBps` is the coach's STORED value the builder displayed — the
      // equality is the canary if the coach's definition ever drifts.
      return answer.headlineBps === undefined || !last
        ? answer
        : {
            ...answer,
            trace: traceSavingsRateDerivation(
              { incomeCents: last.incomeCents, expensesCents: last.expensesCents, monthLabel: ymLabel(last.month) },
              answer.headlineBps,
            ),
          };
    }
    case 'safe_to_spend': {
      // The disclosures ride the plan out of the server (L.18 discipline) and
      // are already resolved against the set the card-payments term sums.
      const plan = await getSpendingPlan(userId);
      return answerSafeToSpend(plan, plan.disclosures);
    }
    case 'cash_needed': {
      const { result, cardDuplicates } = await getCashNeeded(userId);
      // TASKS L.15 (e): the same advisory pair the dashboard hero carries. Ask states this figure
      // to a reader who may never open /cards, so it qualifies it here too.
      const answer = answerCashNeeded(result, accountLabel(resolvePaymentAccount(snap)), cardDuplicates);
      // Slice 3: the trace reshapes the SAME engine result (via the dashboard
      // glass-box rows) — no headlineCents (nothing due) → no figure, no tap.
      return answer.headlineCents === undefined
        ? answer
        : {
            ...answer,
            // The pair reaches the tap-through panel too (L.15 critic P1-1): the answer says both
            // figures may include one card twice, and this is where the reader goes to check.
            trace: traceCashNeededDerivation(result, answer.headlineCents, cardDuplicates),
          };
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
      return answerDebtFreeByDate(result, intent.label, intent.targetDate, today, plan.unallocatedSavingsCents);
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
      return answerSavingsGoalByDate(result, intent.label, intent.targetDate, today, plan.unallocatedSavingsCents);
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
      return answerRetireAtAge(result, intent.label, plan.unallocatedSavingsCents);
    }
    case 'wealth_target': {
      // W.4: SAME two solves the /coach card runs (open-ended pace, then required
      // monthly at the seeded horizon) over getCoachData + getSpendingPlan. The
      // LLM supplied only the KIND — the amount was re-derived by parseTargetAmount.
      const [coach, plan] = await Promise.all([getCoachData(userId), getSpendingPlan(userId)]);
      const wealthContribution = wealthContributionBasis({
        historicalMonthlySavingsCents: coach.fi.monthlySavingsCents,
        plannedSavingsCents: plan.plannedSavingsCents,
        savingsTargetBps: plan.savingsTargetBps,
      });
      const shared = {
        targetAmountCents: intent.targetCents,
        currentPortfolioCents: coach.fi.portfolioCents,
        currentMonthlyContributionCents: wealthContribution.contributionCents,
        nominalReturnBps: coach.fi.expectedReturnBps,
        inflationBps: coach.fi.inflationBps,
        monthlyIncomeCents: coach.fi.monthlyIncomeCents,
        safeToSpendCents: plan.leftToSpendCents,
      };
      const pace = solveWealthTarget({ ...shared, deadlineMonths: null });
      const planUnproven = wealthTargetPlanUnproven(
        wealthContribution.basis,
        coach.fi.monthlySavingsCents,
      );
      const seed = seededHorizon(pace.monthsAtCurrentRate, pace.contributionFloored || planUnproven);
      const required = solveWealthTarget({ ...shared, deadlineMonths: seed.years * 12 });
      return answerWealthTarget(pace, required, {
        horizonYears: seed.years,
        horizonBasis: seed.seeded ? 'seeded' : 'fallback',
        contributionBasis: wealthContribution.basis,
        historicalMonthlySavingsCents: coach.fi.monthlySavingsCents,
        averagedOverMonths: coach.fi.monthlySavingsMonths,
        dialOwnership: {
          returnIsDefault: coach.fi.returnIsDefault,
          inflationIsDefault: coach.fi.inflationIsDefault,
        },
        nominalReturnBps: coach.fi.expectedReturnBps,
        inflationBps: coach.fi.inflationBps,
      });
    }
    case 'what_to_cut': {
      // P.1: SAME findOpportunities list /coach prints, plus the FI
      // counterfactual and radar/cash-dip re-walk — computed once in
      // getCoachData({ cutImpact: true }) so /coach and Ask cannot disagree
      // about what acting on the list moves.
      const coach = await getCoachData(userId, { cutImpact: true });
      return answerWhatToCut({
        opportunities: coach.opportunities,
        moneyDials: coach.moneyDials,
        expectedReturnBps: coach.fi.expectedReturnBps,
        inflationBps: coach.fi.inflationBps,
        dialOwnership: {
          returnIsDefault: coach.fi.returnIsDefault,
          inflationIsDefault: coach.fi.inflationIsDefault,
        },
        counterfactual: coach.cutCounterfactual,
        radarCounterfactual: coach.radarCounterfactual,
      });
    }
    case 'lifestyle_creep': {
      // Standing creep verdict: SAME getCoachData().creep the /coach card prints.
      const coach = await getCoachData(userId);
      return answerLifestyleCreep(coach.creep);
    }
    case 'runway': {
      // Standing cash runway: SAME getCoachData().runwayMonths the /coach card prints.
      const coach = await getCoachData(userId);
      return answerRunway({
        runwayMonths: coach.runwayMonths,
        frozenCashNote: frozenTotalNote(coach.frozenBalances.liquid, {
          figureLabel: 'the cash side of this estimate',
          nextStep: 'accounts-route',
        }),
      });
    }
    case 'conscious_spending': {
      // SAME mapToConsciousBuckets split the /budgets strip prints.
      const plan = await getSpendingPlan(userId);
      return answerConsciousSpending(plan, plan.disclosures);
    }
    case 'stay_wealthy': {
      // SAME composeStayingWealthy row the /coach card prints.
      const coach = await getCoachData(userId);
      return answerStayWealthy(
        composeStayingWealthy({
          cardCleared: coach.streaks.cardCleared,
          runwayMonths: coach.runwayMonths,
          creep: coach.creep,
        }),
      );
    }
    case 'rich_life': {
      // SAME vision the /coach echo reads — getCoachData's read-leg demo fence
      // already nulls it for the shared demo, so the "not written" branch is
      // exactly what a shared visitor gets.
      const coach = await getCoachData(userId);
      return answerRichLife(coach.richLifeVision);
    }
    case 'fi_status': {
      // Standing FI date / number: SAME getCoachData().fi the /coach FI card prints.
      const coach = await getCoachData(userId);
      return answerFiStatus({
        fiNumberCents: coach.fi.fiNumberCents,
        annualExpensesCents: coach.fi.annualExpensesCents,
        monthlySavingsCents: coach.fi.monthlySavingsCents,
        monthlySavingsMonths: coach.fi.monthlySavingsMonths,
        monthsToFI: coach.fi.monthsToFI,
        coastIsCoast: coach.fi.coastIsCoast,
        coastRequiredMonthlyCents: coach.fi.coastRequiredMonthlyCents,
        coastTargetYears: coach.fi.coastTargetYears,
        coastTargetYearsIsAppDefault: coach.fi.coastTargetYearsIsAppDefault,
        portfolioCents: coach.fi.portfolioCents,
        swrBps: coach.fi.swrBps,
        frozenPortfolioNote: frozenTotalNote(coach.frozenBalances.portfolio, {
          figureLabel: 'the portfolio these projections start from',
          nextStep: 'accounts-route',
        }),
      });
    }
    case 'subscriptions':
      return answerSubscriptions((await getRecurring(userId)).summary);
    case 'forecast': {
      const { forecast, accountName, horizonDays } = await getCashFlowForecast(userId);
      return answerForecast(forecast, accountName, horizonDays);
    }
    case 'cash_flow_radar': {
      // DECISIONS #488: same getCashFlowRadar the dashboard card uses — never
      // the recurring-only forecast for "will I run out of money?".
      const { radar, paymentAccountName } = await getCashFlowRadar(userId);
      return answerCashFlowRadar(radar, paymentAccountName);
    }
    case 'unknown':
      return answerUnknown();
    default:
      return answerUnknown();
  }
}
