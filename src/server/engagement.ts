/**
 * EngagementEvent persistence (TASKS 3.1 / DECISIONS #209). Thin I/O around the
 * pure closed-set validator: append-only first-party interaction rows. Never
 * throws — a ledger fault must not break the UI. Nothing reads these rows yet
 * (Wave 3.3 adaptive layout).
 */
import { prisma } from '@/lib/db';
import {
  isValidEngagementEvent,
  type EngagementSubjectKey,
  type EngagementSurface,
  type EngagementVerb,
} from '@/lib/engine/engagement/event';

export interface RecordEngagementInput {
  userId: string;
  surface: EngagementSurface;
  verb: EngagementVerb;
  subjectKey: EngagementSubjectKey;
}

/** Append one engagement row. Returns false on invalid input or DB fault. */
export async function recordEngagementEvent(input: RecordEngagementInput): Promise<boolean> {
  try {
    if (!isValidEngagementEvent(input)) return false;
    await prisma.engagementEvent.create({
      data: {
        userId: input.userId,
        surface: input.surface,
        verb: input.verb,
        subjectKey: input.subjectKey,
      },
    });
    return true;
  } catch {
    return false;
  }
}
