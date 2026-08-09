/**
 * Unknown-question ledger (TASKS 2.2 / DECISIONS #208). Thin I/O around the pure
 * scrub helper: every parser-`unknown` Ask (including LLM-rescued) appends one
 * PII-scrubbed row for later vocabulary mining. Never throws — a ledger fault
 * must not abort the answer.
 */
import { prisma } from '@/lib/db';
import { isDemoUser } from '@/lib/demo-user';
import { scrubQuestionText } from '@/lib/engine/assistant/scrub';

export interface UnknownQuestionInput {
  userId: string;
  rawQuestion: string;
  /** Raw kind from classifyIntentViaLLM before validation; null if LLM not called. */
  llmGuessKind?: string | null;
  /** Final intent.kind after resolve (`unknown` or a rescued kind). */
  resolvedIntent: string;
}

/**
 * Append one scrubbed unknown-question row. No-op when scrub yields empty.
 * Returns true when a row was inserted.
 */
export async function recordUnknownQuestion(input: UnknownQuestionInput): Promise<boolean> {
  // The demo is ONE shared row every anonymous visitor signs into: a question
  // typed here — names, employers, clinics intact (`scrubQuestionText` masks
  // digit runs, not names) — would be mined into vocabulary / shown in the
  // self-audit percentages every LATER visitor sees. The fence lives in the
  // ledger itself so no caller can miss it (the demo fence by construction,
  // same shape as `classifyIntentViaLLM`'s own demo skip in assistant.ts).
  if (isDemoUser(input.userId)) return false;
  try {
    const scrubbedText = scrubQuestionText(input.rawQuestion);
    if (!scrubbedText) return false;
    await prisma.unknownQuestion.create({
      data: {
        userId: input.userId,
        scrubbedText,
        llmGuessKind: input.llmGuessKind ?? null,
        resolvedIntent: input.resolvedIntent,
      },
    });
    return true;
  } catch {
    return false;
  }
}
