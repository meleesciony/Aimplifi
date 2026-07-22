/**
 * Ask Aimplifi — LLM intent classifier (DECISIONS #75, mirrors llm-categorize.ts).
 * Maps a genuinely-unrecognized question to one of our known intent KINDS — never
 * to an answer. Provider selection and the round-trip itself live in
 * `llm-provider.ts` (one copy for all five LLM paths); the behaviour is unchanged:
 *   - XAI_API_KEY set        → xAI Grok (OpenAI-compatible) — PREFERRED.
 *   - else ANTHROPIC_API_KEY → Anthropic Messages API.
 *   - neither                → null (deterministic routing stands; demo needs no key).
 *   - any network/parse failure → null (never throws).
 * The returned kind is re-parameterized deterministically from the user's words
 * (intentFromKind), so the model can only pick a route, never a number.
 *
 * Plain module (was 'use server' before #242): every caller is server-side, and
 * the directive needlessly exposed this as an invokable action endpoint — a
 * client could burn provider credits. Not `server-only` either: vocab.ts pulls
 * this into the tsx-script import graph (e2e vocab fixture), where that package
 * throws at import — same posture as vocab.ts/authz.ts themselves.
 * `onOutcome` (AI plan §3.2): exactly one report per ATTEMPTED call —
 * 'replied' (a kind pinned to LLM_ROUTABLE_KINDS), 'rejected' (reply discarded),
 * 'unavailable' (provider error/timeout). No key → sink not invoked. Awaited but
 * fire-walled: a sink fault can never break routing.
 */
import type { AiOutcomeSink } from '@/lib/engine/ai-audit/describe';
import { buildIntentPrompt, parseIntentKind } from '@/lib/engine/assistant/llm';
import { llmCompleteText, llmProviderConfigured } from '@/server/llm-provider';

/** Enough for `{"intent":"..."}` and nothing more — the model picks a route, not prose. */
const MAX_TOKENS = 20;

/** First JSON object in the model text → its `intent` kind, validated (→ null if bad). */
function kindFromText(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return parseIntentKind(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return null;
  }
}

export async function classifyIntentViaLLM(
  question: string,
  onOutcome?: AiOutcomeSink,
): Promise<string | null> {
  if (!llmProviderConfigured()) return null; // no key → no network, deterministic routing only

  // null = unavailable (non-OK / network error / timeout / malformed body).
  const text = await llmCompleteText(buildIntentPrompt(question), MAX_TOKENS);

  const kind = text === null ? null : kindFromText(text);
  try {
    // `kind` is already pinned to LLM_ROUTABLE_KINDS by parseIntentKind — the
    // one value logged is closed-set, never the user's question text (§3.2).
    await onOutcome?.(text === null ? 'unavailable' : kind ? 'replied' : 'rejected', kind ? { kind } : {});
  } catch {
    // an audit fault must never break routing
  }
  return kind;
}
