'use server';

/**
 * Learned-vocabulary user actions (TASKS 2.3 / DECISIONS #225). The session lives
 * here so server/vocab.ts (which the cron imports) stays free of NextAuth.
 *
 * Undo is a first-class citizen of the audit §4 constitution: every adaptation is a
 * visible row the user can revoke. Revoking is TERMINAL — the phrase is tombstoned,
 * not merely un-served, so the next mining run cannot re-learn it from the same
 * evidence the user just told us was wrong.
 */
import { revalidatePath } from 'next/cache';
import { requireUserId } from '@/server/authz';
import { retireVocabEntry } from '@/server/vocab';
import { prisma } from '@/lib/db';

/** Forget one learned phrasing. Returns true when a row was retired by this call. */
export async function forgetLearnedPhrase(entryId: string): Promise<boolean> {
  const userId = await requireUserId();
  const id = (entryId ?? '').trim();
  if (!id || id.length > 64) return false;
  const retired = await retireVocabEntry(userId, id);
  if (retired) {
    // The rejection is itself the strongest signal in the loop — keep it auditable.
    try {
      await prisma.auditLog.create({
        data: { userId, action: 'vocab.retired', meta: JSON.stringify({ entryId: id }) },
      });
    } catch {
      /* an audit-write fault must not undo the user's undo */
    }
    revalidatePath('/settings');
  }
  return retired;
}
