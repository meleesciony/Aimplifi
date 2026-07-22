import 'server-only';

/**
 * Balance-Move Explainer — LLM template drafter (AI plan §2.3, DECISIONS #240;
 * mirrors assistant-llm.ts / llm-categorize.ts). This is the ONLY place a model
 * touches this surface, and its output is worthless until `resolveMoveSentence`
 * re-checks it: the model may only (a) echo the primary-driver id we already
 * computed and (b) return a placeholder+connective TEMPLATE — never a figure and
 * never free prose. The engine substitutes every number. It is NOT a 'use server'
 * action (only `getBalanceMove` calls it, server-side). Provider-agnostic + graceful:
 *   - XAI_API_KEY set        → xAI Grok (OpenAI-compatible) — PREFERRED.
 *   - else ANTHROPIC_API_KEY → Anthropic Messages API.
 *   - neither / any failure  → null (the deterministic template stands; demo needs no key).
 */
import type { AiOutcomeSink } from '@/lib/engine/ai-audit/describe';
import { buildMovePrompt, type BalanceMoveExplanation, type LlmMoveDraft } from '@/lib/engine/trends/balance-move';
import { llmCompleteText, llmProviderConfigured } from '@/server/llm-provider';

/** Enough for a placeholder template and a driver id — never prose. The round-trip
 *  is bounded in llm-provider.ts so a slow provider never delays the page. */
const MAX_TOKENS = 120;

/** First JSON object in model text → a shape-checked draft (→ null if malformed). */
function draftFromText(text: string): LlmMoveDraft | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (typeof obj !== 'object' || obj === null) return null;
    const { primaryDriverId, template } = obj as Record<string, unknown>;
    if (typeof primaryDriverId !== 'string' || typeof template !== 'string') return null;
    if (!primaryDriverId.trim() || !template.trim()) return null;
    return { primaryDriverId, template };
  } catch {
    return null;
  }
}

export async function draftMoveSentenceViaLLM(
  e: BalanceMoveExplanation,
  onOutcome?: AiOutcomeSink,
): Promise<LlmMoveDraft | null> {
  if (!e.triggered || e.primaryDriverId === null) return null;
  if (!llmProviderConfigured()) return null; // no key → no network, deterministic template only

  // null = unavailable (non-OK / network error / timeout / malformed body). §3.2:
  // the sink is told exactly once what happened; no key → not invoked; a sink
  // fault never breaks the template.
  const text = await llmCompleteText(buildMovePrompt(e), MAX_TOKENS);

  const draft = text === null ? null : draftFromText(text);
  try {
    // EMPTY meta by design: the draft is only shape-checked here (resolveMoveSentence
    // does the real validation later), so its strings are still MODEL-AUTHORED TEXT —
    // persisting them would let model prose reach the ledger renderer (§3.2).
    await onOutcome?.(text === null ? 'unavailable' : draft ? 'replied' : 'rejected', {});
  } catch {
    // an audit fault must never break the deterministic template
  }
  return draft;
}
