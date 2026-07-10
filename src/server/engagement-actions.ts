'use server';

/**
 * Client-callable engagement logger (TASKS 3.1). Ownership via requireUserId;
 * closed-set validation in the engine; never throws to the client.
 */
import { requireUserId } from '@/server/authz';
import { recordEngagementEvent } from '@/server/engagement';
import type {
  EngagementSubjectKey,
  EngagementSurface,
  EngagementVerb,
} from '@/lib/engine/engagement/event';

export async function logEngagement(input: {
  surface: EngagementSurface;
  verb: EngagementVerb;
  subjectKey: EngagementSubjectKey;
}): Promise<boolean> {
  try {
    const userId = await requireUserId();
    return await recordEngagementEvent({ userId, ...input });
  } catch {
    return false;
  }
}
