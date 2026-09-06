'use server';

/**
 * Update ONLY a transaction's note. taxClass stays put.
 *
 * Detail still uses setTransactionTax (note + taxClass together). Home needs a
 * note-only path so saving a recent-charge note cannot clear the tax tag.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { auditLog, requireUserId } from '@/server/authz';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { normalizeNote, noteErrorMessage } from '@/lib/engine/tax/note';

export interface TxnNoteResult {
  ok: boolean;
  error?: string;
  errors?: { note?: string };
}

export async function updateTransactionNote(
  transactionId: string,
  formData: FormData,
): Promise<TxnNoteResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const id = typeof transactionId === 'string' ? transactionId.trim() : '';
  if (!id) {
    return { ok: false, error: "That transaction isn't on your list, so nothing changed." };
  }

  const raw = String(formData.get('note') ?? '');
  const note = normalizeNote(raw);
  if (!note.ok) return { ok: false, errors: { note: noteErrorMessage(note.error) } };

  // Ownership through the account. updateMany keeps the check and the write one
  // statement. data touches the note column only — the tax tag column is intentionally omitted.
  const written = await prisma.transaction.updateMany({
    where: { id, account: { userId } },
    data: { note: note.note },
  });
  if (written.count === 0) {
    return { ok: false, error: "That transaction isn't on your list, so nothing changed." };
  }

  // Note TEXT stays out of the audit trail — length only.
  await auditLog(userId, 'transaction.note.set', {
    transactionId: id,
    noteChars: note.note?.length ?? 0,
  });

  revalidatePath('/dashboard');
  revalidatePath('/transactions');
  return { ok: true };
}
