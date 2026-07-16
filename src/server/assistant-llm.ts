/**
 * Ask Aimplifi — LLM intent classifier (DECISIONS #75, mirrors llm-categorize.ts).
 * Maps a genuinely-unrecognized question to one of our known intent KINDS — never
 * to an answer. Provider-agnostic + graceful:
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

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const XAI_URL = 'https://api.x.ai/v1/chat/completions';
const XAI_DEFAULT_MODEL = 'grok-3-mini';
/** Bound the classifier round-trip so a slow/unreachable provider can never hang
 *  the answer — on timeout we abort and fall back to deterministic routing. */
const TIMEOUT_MS = 7000;

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
  const xaiKey = process.env.XAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!xaiKey && !anthropicKey) return null; // no key → no network, deterministic routing only

  const prompt = buildIntentPrompt(question);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  // null until the provider yields a usable text body (non-OK / network error /
  // timeout / malformed body → 'unavailable').
  let text: string | null = null;
  try {
    if (xaiKey) {
      const res = await fetch(XAI_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${xaiKey}` },
        body: JSON.stringify({
          model: process.env.XAI_MODEL ?? XAI_DEFAULT_MODEL,
          max_tokens: 20,
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
          max_tokens: 20,
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
