'use server';

/**
 * "My Rich Life" vision mutation (C.13 / plan P1.3). Session verified, fenced
 * for the shared demo, normalized through the pure engine, audit-logged, and
 * followed by revalidating the two surfaces that render it.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { auditLog, requireUserId } from '@/server/authz';
import {
  normalizeRichLifeVision,
  richLifeErrorMessage,
} from '@/lib/engine/settings/rich-life';

export interface RichLifeResult {
  ok: boolean;
  /** Top-level refusal (the demo fence) or the validation message. */
  error?: string;
  /** On `ok`: whether a vision is now stored (false = cleared). The success
   *  message must not claim the coach "opens with it" when the reader just
   *  cleared it (critic F5). */
  hasVision?: boolean;
}

export async function updateRichLife(
  _prev: RichLifeResult | null,
  formData: FormData,
): Promise<RichLifeResult> {
  const userId = await requireUserId();

  // The demo is ONE shared row every anonymous visitor signs into: a vision
  // typed here would be echoed atop /coach to every later visitor by
  // `getCoachData` — the typed-input leg of the shared-account rule (household
  // seat #210, learned vocabulary #226, planning dials #243). The Settings card
  // hides the form for demo; this is the server-side defense in depth.
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const result = normalizeRichLifeVision(String(formData.get('vision') ?? ''));
  if (!result.ok) return { ok: false, error: richLifeErrorMessage(result.error) };

  await prisma.user.update({
    where: { id: userId },
    data: { richLifeVision: result.vision },
  });

  await auditLog(userId, 'settings.richLife.update', {
    hasVision: result.vision !== null,
  });

  // The /coach echo renders from the column this mutation wrote.
  revalidatePath('/settings');
  revalidatePath('/coach');

  return { ok: true, hasVision: result.vision !== null };
}
