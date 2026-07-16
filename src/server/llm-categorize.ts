import 'server-only';

/**
 * LLM categorization client (DECISIONS #38, #64). Proposes a category for an
 * unknown transaction via a hosted LLM. Provider-agnostic + graceful:
 *   - XAI_API_KEY set        → xAI Grok (OpenAI-compatible, cheaper) — PREFERRED.
 *   - else ANTHROPIC_API_KEY  → Anthropic Messages API.
 *   - neither                → null (deterministic pipeline stands; demo needs no key).
 *   - any network/parse/validation failure OR a 7s timeout → null (never throws,
 *     never hangs — an unbounded fetch would stall the calling server action).
 * The result is always validated by parseLlmCategory before use, so a malformed
 * or hallucinated category can't reach the ledger.
 *
 * `import 'server-only'` (was 'use server' before #242): every caller is
 * server-side, and the 'use server' directive needlessly exposed this as an
 * invokable action endpoint — a client could burn provider credits. Now the
 * bundler refuses any client import outright.
 *
 * `onOutcome` (AI plan §3.2, DECISIONS #242): when a provider call is ATTEMPTED
 * (a key exists), the sink is told exactly once what happened — 'replied' (valid
 * category), 'rejected' (the validator discarded the reply), or 'unavailable'
 * (provider error/timeout). No key → no call → the sink is NOT invoked. The
 * sink is awaited but fire-walled: a sink fault can never break categorization.
 */
import type { AiOutcomeSink } from '@/lib/engine/ai-audit/describe';
import { buildCategorizePrompt, type LlmCategory, parseLlmCategory } from '@/lib/engine/categorize/llm';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const XAI_URL = 'https://api.x.ai/v1/chat/completions';
const XAI_DEFAULT_MODEL = 'grok-3-mini';
// Bound the provider round-trip (same budget as assistant-llm.ts). Without a
// signal, a hung fetch never settles and the CALLING SERVER ACTION never returns —
// no error, no log line, just a button stuck disabled-while-pending (the
// phase2-triage stall signature, STATUS 2026-07-04). On abort the catch below
// returns null and the deterministic pipeline stands.
const TIMEOUT_MS = 7000;

/** Extract the first JSON object from model text and validate it (→ null if bad). */
function parseFromText(text: string): LlmCategory | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return parseLlmCategory(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return null;
  }
}

export async function suggestCategoryViaLLM(
  input: {
    rawDescriptor: string;
    amountCents: number;
  },
  onOutcome?: AiOutcomeSink,
): Promise<LlmCategory | null> {
  const prompt = buildCategorizePrompt(input);
  const xaiKey = process.env.XAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!xaiKey && !anthropicKey) return null; // no provider key → no network, deterministic fallback

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  // null until the provider yields a usable text body — anything short of that
  // (non-OK status, network error, timeout abort, malformed body) is 'unavailable'.
  let text: string | null = null;
  try {
    if (xaiKey) {
      // xAI Grok — OpenAI-compatible /chat/completions (cheaper than Anthropic).
      const res = await fetch(XAI_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${xaiKey}` },
        body: JSON.stringify({
          model: process.env.XAI_MODEL ?? XAI_DEFAULT_MODEL,
          max_tokens: 100,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: controller.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        text = data?.choices?.[0]?.message?.content ?? '';
      }
    } else if (anthropicKey) {
      const res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL ?? ANTHROPIC_DEFAULT_MODEL,
          max_tokens: 100,
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
    text = null; // network error, timeout abort, bad body JSON → unavailable
  } finally {
    clearTimeout(timer);
  }

  const value = text === null ? null : parseFromText(text);
  try {
    // Meta is closed-set only: parseLlmCategory already pinned categoryId to the
    // fixed list and capped confidenceBps — safe to persist and render (§3.2).
    await onOutcome?.(
      text === null ? 'unavailable' : value ? 'replied' : 'rejected',
      value ? { categoryId: value.categoryId, confidenceBps: value.confidenceBps } : {},
    );
  } catch {
    // an audit fault must never break categorization
  }
  return value;
}
