'use server';

/**
 * The write path for a transaction's note and tax tag.
 *
 * Shipped in the SAME slice as the columns it fills, on purpose (the L.22 lesson): a
 * persisted field with no control that writes it is a dead branch that reads as a
 * feature. If this file did not exist, neither column should.
 *
 * Returns `{ ok, error }` and never throws for an expected refusal (the mutation-form
 * recipe): a throw reaches the route error boundary and takes the register — and
 * whatever the reader had typed into the note — with it.
 *
 * A `'use server'` module may export only async functions, so the cap, the class set
 * and the messages live in the pure modules under `src/lib/engine/tax/`.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { auditLog, requireUserId } from '@/server/authz';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { isTaxClass } from '@/lib/engine/tax/classes';
import { normalizeNote, noteErrorMessage } from '@/lib/engine/tax/note';

export type SetTransactionTaxResult = { ok: true } | { ok: false; error: string };

/**
 * Set (or clear) the note and the tax class on one transaction.
 *
 * Both fields are written TOGETHER because one panel edits them together: sending
 * only the changed one would make "I cleared the note" indistinguishable from "I
 * didn't touch the note", and the reader would find out which the app assumed at tax
 * time. The caller always sends both, and both are always written.
 */
export async function setTransactionTax(input: {
  transactionId: string;
  /** A `TaxClass` slug, or null to untag. */
  taxClass: string | null;
  /** The note as typed; trimmed and capped here, not in the control alone. */
  note: string | null;
}): Promise<SetTransactionTaxResult> {
  const userId = await requireUserId();

  // The shared-demo fence (the `demo-user.ts` rule: anything that accumulates a
  // user's OWN input and shows it back is opted out, because every anonymous visitor
  // is the same row). A note is the clearest case of that shape in the whole app —
  // "mum's prescription" typed by one visitor would greet the next one — and the tag
  // travels with it into an export, so the pair is fenced as the single gesture it is.
  // The panel deliberately still OPENS for a demo visitor: this message tells them
  // what the feature does and how to get it, which hiding the control would not.
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  // Reject an unrecognized class rather than storing it. `isTaxClass` also guards the
  // READ side, so a bad value would degrade to "untagged" rather than corrupt a
  // total — but a tag that silently does nothing is worse than a refusal: the reader
  // would see it accepted and find the row missing from the export months later.
  if (input.taxClass !== null && !isTaxClass(input.taxClass)) {
    return { ok: false, error: 'That is not a tax category Aimplifi knows — nothing was saved.' };
  }

  const note = normalizeNote(input.note);
  if (!note.ok) return { ok: false, error: noteErrorMessage(note.error) };

  // Ownership through the account, the same join every other transaction write uses.
  // `updateMany` with the ownership predicate IN the where clause makes the check and
  // the write one statement, so there is no window between them.
  const written = await prisma.transaction.updateMany({
    where: { id: input.transactionId, account: { userId } },
    data: { taxClass: input.taxClass, note: note.note },
  });
  if (written.count === 0) return { ok: false, error: 'That transaction is no longer available — nothing was saved.' };

  // The tag is logged; the note's TEXT is not. A note is the most personal thing in
  // this app ("mum's prescription") and an audit trail is the wrong place for it —
  // its length is enough to show that a write happened.
  await auditLog(userId, 'transaction.tax.set', {
    transactionId: input.transactionId,
    taxClass: input.taxClass,
    noteChars: note.note?.length ?? 0,
  });

  revalidatePath('/transactions');
  // The settings page lists the years there is something to export for, and this
  // write is exactly what can add a year to that list.
  revalidatePath('/settings');
  return { ok: true };
}
