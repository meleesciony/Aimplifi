/**
 * Reading attachments (O.13h). Prisma only — no session lookup, no React — so the
 * routes and the detail view can both call it and it stays testable without auth.
 *
 * OWNERSHIP IS ALWAYS DERIVED, NEVER PASSED. Every query here reaches the user
 * through `transaction.account.userId` rather than trusting a userId column on the
 * attachment row, because the thing that owns a receipt is the account the charge
 * landed in — and a denormalized copy is one re-key away from disagreeing with it
 * (the L.33 rule: ask "who owns this?" of the thing that owns the VALUE).
 *
 * HOUSEHOLD SCOPE, DECIDED HERE: an attachment is visible ONLY to the account's own
 * user, never to a household partner with shared-account access. Sharing an account's
 * transactions is a decision about amounts and merchants; a receipt is a photograph
 * that can carry a full name, a home address, a prescription or the last four digits
 * of a different card. The failure directions are not symmetric — a partner not
 * seeing a receipt is an inconvenience they can ask about, a partner seeing one is a
 * disclosure that cannot be taken back — so the shared surfaces do not render these
 * and no query here accepts a viewer.
 */
import { prisma } from '@/lib/db';

export type AttachmentListItem = {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
};

/**
 * The metadata for one transaction's attachments, oldest first.
 *
 * Returns no bytes — and cannot, because the file lives in its own table (see the
 * schema comment on `AttachmentBlob`). That is the point of the split: a list this
 * page renders on every visit can never accidentally become a multi-megabyte read.
 */
export async function listAttachmentsForTransaction(
  userId: string,
  transactionId: string,
): Promise<AttachmentListItem[]> {
  const rows = await prisma.transactionAttachment.findMany({
    where: { transactionId, transaction: { account: { userId } } },
    select: { id: true, filename: true, mimeType: true, byteSize: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows;
}

/** How many files this transaction already holds — the input to the per-row cap. */
export async function countAttachmentsForTransaction(
  userId: string,
  transactionId: string,
): Promise<number> {
  return prisma.transactionAttachment.count({
    where: { transactionId, transaction: { account: { userId } } },
  });
}

/**
 * The file itself, for the download route. Null when it does not exist OR is not
 * this user's — deliberately the same answer, so the route can return one 404 and
 * never reveal that an id exists but belongs to somebody else.
 */
export async function readAttachmentForUser(
  userId: string,
  attachmentId: string,
): Promise<{ filename: string; mimeType: string; bytes: Uint8Array } | null> {
  const row = await prisma.transactionAttachment.findFirst({
    where: { id: attachmentId, transaction: { account: { userId } } },
    select: { filename: true, mimeType: true, blob: { select: { bytes: true } } },
  });
  if (!row?.blob) return null;
  return { filename: row.filename, mimeType: row.mimeType, bytes: row.blob.bytes };
}
