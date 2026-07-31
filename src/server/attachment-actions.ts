'use server';

/**
 * Removing an attachment (O.13h).
 *
 * A server action rather than a route, unlike the upload: deleting carries a single
 * id, so none of the body-size reasoning that moved the upload to `/api/attachments`
 * applies, and this belongs with every other per-row action.
 *
 * NO DEMO FENCE HERE, deliberately. The upload route fences the demo account, so a
 * demo visitor can never own an attachment, and the ownership predicate below
 * already answers with "no longer available" for a row they do not own. A fence
 * added here would be a branch nothing can reach — which reads to the next editor as
 * a claim that something is handled, and hides that the real guard is upstream.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { auditLog, requireUserId } from '@/server/authz';

export type DeleteAttachmentResult = { ok: true } | { ok: false; error: string };

/**
 * Delete one attachment. Returns a refusal rather than throwing (the mutation-form
 * recipe): a throw reaches the route error boundary and takes the whole detail view
 * with it.
 *
 * The bytes go with it: `AttachmentBlob` cascades from this row, which is the same
 * mechanism that makes account deletion and user deletion complete without a second
 * code path. There is no soft-delete — the retention policy promises removal means
 * removal.
 */
export async function deleteTransactionAttachment(input: {
  attachmentId: string;
}): Promise<DeleteAttachmentResult> {
  const userId = await requireUserId();

  // A Server Action argument arrives over the wire and TypeScript is erased, so this
  // is a runtime check and not a formality: without it `{"attachmentId":{"not":""}}`
  // reaches Prisma as a FILTER OPERATOR rather than an id, matches every row the
  // conjunct below allows, and deletes every receipt this user owns while returning
  // `{ ok: true }`. Proven by execution in the O.13h critic cycle. Every other
  // per-row action here already guards its scalars the same way
  // (`transaction-flags-actions.ts:48`, `recurring-override-actions.ts:88`, …);
  // this file was the one that skipped it.
  if (typeof input?.attachmentId !== 'string' || input.attachmentId.length === 0) {
    return { ok: false, error: 'That file is no longer available — nothing was changed.' };
  }

  // Ownership IN the where clause, so the check and the delete are one statement and
  // there is no window between them. Reached through the account, like every other
  // transaction write.
  const { count } = await prisma.transactionAttachment.deleteMany({
    where: { id: input.attachmentId, transaction: { account: { userId } } },
  });
  if (count === 0) {
    return { ok: false, error: 'That file is no longer available — nothing was changed.' };
  }

  await auditLog(userId, 'transaction.attachment.delete', { attachmentId: input.attachmentId });

  revalidatePath('/transactions');
  return { ok: true };
}
