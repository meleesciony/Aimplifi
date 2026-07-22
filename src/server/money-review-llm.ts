import 'server-only';

/**
 * Monthly Money Review — LLM ORDERER (AI plan §2.4; mirrors balance-move-llm.ts /
 * assistant-llm.ts). This is the ONLY place a model touches this surface, and its output
 * is worthless until `selectReview` re-checks it: the model may only return an ORDERED
 * ARRAY OF CANDIDATE IDS we already computed — never a line, a number, or a new id. The
 * engine renders every line verbatim. NOT a 'use server' action (only `getCoachData`
 * calls it, server-side). Provider-agnostic + graceful:
 *   - XAI_API_KEY set        → xAI Grok (OpenAI-compatible) — PREFERRED.
 *   - else ANTHROPIC_API_KEY → Anthropic Messages API.
 *   - neither / any failure  → null (the deterministic floor stands; demo needs no key).
 */
import type { AiOutcomeSink } from '@/lib/engine/ai-audit/describe';
import {
  buildReviewPrompt,
  parseReviewOrder,
  type ReviewCandidate,
  type ReviewCandidateId,
} from '@/lib/engine/fi/money-review';
import { llmCompleteText, llmProviderConfigured } from '@/server/llm-provider';

/** Enough for an ordered id array and nothing more. The round-trip is bounded in
 *  llm-provider.ts so a slow provider never delays the page — abort → deterministic floor. */
const MAX_TOKENS = 120;

/** First JSON array in model text → a validated ordered id list (→ null if malformed/empty). */
function orderFromText(text: string): ReviewCandidateId[] | null {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try {
    return parseReviewOrder(JSON.parse(text.slice(start, end + 1)) as unknown);
  } catch {
    return null;
  }
}

export async function orderReviewViaLLM(
  candidates: readonly ReviewCandidate[],
  onOutcome?: AiOutcomeSink,
): Promise<ReviewCandidateId[] | null> {
  if (candidates.length === 0) return null;
  if (!llmProviderConfigured()) return null; // no key → no network, deterministic floor only

  // null = unavailable (non-OK / network error / timeout / malformed body). §3.2:
  // the sink is told exactly once what happened; no key → not invoked; a sink
  // fault never breaks the floor.
  const text = await llmCompleteText(buildReviewPrompt(candidates), MAX_TOKENS);

  const order = text === null ? null : orderFromText(text);
  try {
    // Only a COUNT is logged — the ids are engine-authored but a count suffices
    // for the ledger line, keeping the persisted meta minimal (§3.2).
    await onOutcome?.(
      text === null ? 'unavailable' : order ? 'replied' : 'rejected',
      order ? { count: order.length } : {},
    );
  } catch {
    // an audit fault must never break the deterministic floor
  }
  return order;
}
