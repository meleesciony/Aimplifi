/**
 * Attachment upload (O.13h): POST /api/attachments  (multipart: transactionId, file)
 *
 * WHY A ROUTE HANDLER AND NOT A SERVER ACTION, since nearly every per-row write in
 * this app is an action (the push-subscription routes are the other exception): Next caps a Server Action body at 1 MB by default, and a
 * phone photo of a receipt is several times that. The alternatives were raising
 * `serverActions.bodySizeLimit` — which loosens the ceiling for EVERY action in the
 * app to serve one feature — or accepting the upload where a large body is normal.
 * The delete stays a server action, because deleting is a small payload and belongs
 * with every other row action.
 *
 * Everything else follows the same rules as the rest of the app: the session is
 * re-verified here even though middleware already gated the path, the query is
 * scoped by userId, the shared demo account is fenced, the write is audit-logged
 * without the filename, and the request is rate-limited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { auditLog, rateLimitDurable } from '@/server/authz';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import {
  MAX_ATTACHMENT_BYTES,
  attachmentRefusalMessage,
  validateAttachment,
} from '@/lib/engine/attachments/attachment';

function refuse(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return refuse('Unauthorized', 401);

  // CSRF. A Server Action gets this check from the framework; a hand-written POST
  // route does not, so it is written out. The session cookie is SameSite=Lax, which
  // already means a cross-site POST arrives without credentials and fails the check
  // above — this is the second of the two, not the only one. Origin is compared when
  // present (every browser sends it on a POST); a request with none cannot be a
  // cross-origin browser request.
  const origin = request.headers.get('origin');
  if (origin !== null) {
    const host = request.headers.get('host');
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (originHost === null || originHost !== host) return refuse('Bad origin', 403);
  }

  if (!(await rateLimitDurable(`attachment-upload:${userId}`, 30, 60_000))) {
    return refuse('Too many uploads — wait a minute and try again.', 429);
  }

  // The shared-demo fence (`demo-user.ts`): every anonymous visitor is the same row,
  // so anything a visitor BRINGS would be handed to the next one. A receipt is the
  // most literal case of that shape in the app — a photograph, with a name on it.
  // The control still renders for a demo visitor and this message explains why it
  // will not take a file, which hiding it would not.
  if (isDemoUser(userId)) return refuse(DEMO_ENTRY_BLOCKED, 403);

  // A cheap early exit for a client that ANNOUNCES an oversized body. Stated
  // accurately, because the first version of this comment claimed it rejects the body
  // "before buffering it" and that was false: the header is optional (HTTP/2 does not
  // require it, and `Transfer-Encoding: chunked` omits it), so a request without one
  // skips this entirely and `request.formData()` below still buffers. The real ceiling
  // is `validateAttachment`, which counts the bytes that actually arrived; this only
  // saves work in the honest case.
  const declared = request.headers.get('content-length');
  const declaredLength = declared === null ? null : Number(declared);
  if (declaredLength !== null && Number.isFinite(declaredLength) && declaredLength > MAX_ATTACHMENT_BYTES * 2) {
    return refuse(attachmentRefusalMessage('too-large'), 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return refuse('That upload could not be read — nothing was saved.', 400);
  }

  const transactionId = form.get('transactionId');
  const file = form.get('file');
  if (typeof transactionId !== 'string' || transactionId.length === 0) {
    return refuse('That upload was missing its transaction — nothing was saved.', 400);
  }
  if (!(file instanceof File)) {
    return refuse('No file was attached — nothing was saved.', 400);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // Ownership and the existing count in ONE scoped read, then the write — the same
  // shape as every other per-row write here (`setTransactionTax`), and deliberately
  // NOT an interactive transaction.
  //
  // An earlier cut wrapped all three in `prisma.$transaction`. It bought almost
  // nothing and it was the only write path in this app holding the local SQLite
  // write lock across three round trips, in a harness that runs four Playwright
  // workers and a `next start` server against one file — write contention there is
  // documented in `playwright.config.ts`. The row and its bytes are still atomic:
  // the nested `blob: { create }` runs inside Prisma's own implicit transaction for
  // nested writes, so the metadata row and its bytes commit together. (Stated as the
  // mechanism it actually is: an earlier draft called it "one statement", which is not
  // true and would invite someone to optimise the guarantee away. `readAttachmentForUser`
  // also returns null when the blob is missing, so even then the read path 404s rather
  // than serving an empty file.)
  //
  // What the two remaining races cost, stated rather than papered over:
  //  - The transaction is deleted between the read and the write → the foreign key
  //    refuses and the reader is told the transaction is gone, which is true.
  //  - Two uploads race the CAP and both see 4 → one extra file on one row. A lease
  //    would be ceremony for that.
  // Ownership is not one of them: it is re-read here and cannot be raced into.
  // Scoped the same way the DETAIL PAGE is, not merely by ownership. `getTransactionDetail`
  // additionally requires a spending-account type, so an upload aimed at an INVESTMENT or
  // LOAN row would have been stored against a page that 404s — bytes with no Remove button
  // anywhere in the UI, removable only by deleting the account. The UI never offers that,
  // but the route is reachable directly, and unreachable bytes are a retention problem.
  const owned = await prisma.transaction.findFirst({
    where: {
      id: transactionId,
      account: { userId, type: { in: [...SPENDING_ACCOUNT_TYPES] } },
    },
    select: { id: true, _count: { select: { attachments: true } } },
  });
  if (!owned) {
    return refuse('That transaction is no longer available — nothing was saved.', 404);
  }

  const validated = validateAttachment({
    filename: file.name,
    bytes,
    existingCount: owned._count.attachments,
  });
  if (!validated.ok) {
    return refuse(
      attachmentRefusalMessage(validated.refusal),
      validated.refusal === 'too-large' ? 413 : 400,
    );
  }

  // The store can still fail — a lock timeout, a disk error, a row deleted a
  // millisecond ago. This is not defensive decoration: a 500 was observed once
  // under full-suite contention, and an unhandled throw hands the browser a
  // non-JSON body that the upload form can only report as a generic shrug. A
  // refusal written for the reader is the difference between "try again" and
  // "something went wrong".
  let created: { id: string };
  try {
    created = await prisma.transactionAttachment.create({
      data: {
        transactionId,
        filename: validated.attachment.filename,
        mimeType: validated.attachment.mimeType,
        byteSize: validated.attachment.byteSize,
        blob: { create: { bytes } },
      },
      select: { id: true },
    });
  } catch {
    return refuse('That file could not be saved just now — nothing was saved. Try again.', 500);
  }

  // The FILENAME is not logged. A receipt is named by its owner ("mri-invoice.pdf"),
  // which is the same reasoning that keeps the note's text out of the audit trail —
  // the type and the size are enough to show a write happened.
  await auditLog(userId, 'transaction.attachment.add', {
    transactionId,
    attachmentId: created.id,
    mimeType: validated.attachment.mimeType,
    byteSize: validated.attachment.byteSize,
  });

  return NextResponse.json({
    ok: true,
    attachment: {
      id: created.id,
      filename: validated.attachment.filename,
      mimeType: validated.attachment.mimeType,
      byteSize: validated.attachment.byteSize,
    },
  });
}
