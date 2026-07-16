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

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const XAI_URL = 'https://api.x.ai/v1/chat/completions';
const XAI_DEFAULT_MODEL = 'grok-3-mini';
/** Bound the round-trip so a slow provider never delays the page — abort → deterministic floor. */
const TIMEOUT_MS = 7000;

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
  const xaiKey = process.env.XAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!xaiKey && !anthropicKey) return null; // no key → no network, deterministic floor only

  const prompt = buildReviewPrompt(candidates);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  // null until the provider yields a usable text body (non-OK / network error /
  // timeout / malformed body → 'unavailable'). §3.2: the sink is told exactly
  // once what happened; no key → not invoked; a sink fault never breaks the floor.
  let text: string | null = null;
  try {
    if (xaiKey) {
      const res = await fetch(XAI_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${xaiKey}` },
        body: JSON.stringify({
          model: process.env.XAI_MODEL ?? XAI_DEFAULT_MODEL,
          max_tokens: 120,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        text = data?.choices?.[0]?.message?.content ?? '';
      }
    } else {
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': anthropicKey!, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL ?? ANTHROPIC_DEFAULT_MODEL,
          max_tokens: 120,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as { content?: { text?: string }[] };
        text = Array.isArray(data?.content) ? data.content.map((b) => b?.text ?? '').join('') : '';
      }
    }
  } catch {
    text = null; // network error / abort / bad body JSON → unavailable
  } finally {
    clearTimeout(timer);
  }

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
