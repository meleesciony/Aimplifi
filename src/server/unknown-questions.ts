/**
 * Unknown-question ledger (TASKS 2.2 / DECISIONS #208). Thin I/O around the pure
 * scrub helper: every parser-`unknown` Ask (including LLM-rescued) appends one
 * PII-scrubbed row for later vocabulary mining. Never throws — a ledger fault
 * must not abort the answer.
 */
import { prisma } from '@/lib/db';
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
