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
import { buildMovePrompt, type BalanceMoveExplanation, type LlmMoveDraft } from '@/lib/engine/trends/balance-move';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const XAI_URL = 'https://api.x.ai/v1/chat/completions';
const XAI_DEFAULT_MODEL = 'grok-3-mini';
/** Bound the round-trip so a slow provider never delays the page — abort → template. */
const TIMEOUT_MS = 7000;

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

export async function draftMoveSentenceViaLLM(e: BalanceMoveExplanation): Promise<LlmMoveDraft | null> {
  if (!e.triggered || e.primaryDriverId === null) return null;
  const xaiKey = process.env.XAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!xaiKey && !anthropicKey) return null; // no key → no network, deterministic template only

  const prompt = buildMovePrompt(e);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
      if (!res.ok) return null;
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return draftFromText(data?.choices?.[0]?.message?.content ?? '');
    }

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
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { text?: string }[] };
    const text = Array.isArray(data?.content) ? data.content.map((b) => b?.text ?? '').join('') : '';
    return draftFromText(text);
  } catch {
    return null; // network error / abort / bad JSON → deterministic template only
  } finally {
    clearTimeout(timer);
  }
}
