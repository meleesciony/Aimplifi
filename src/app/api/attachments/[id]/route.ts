/**
 * Attachment download (O.13h): GET /api/attachments/<id>
 *
 * This is the only route in the app that serves back a file the user UPLOADED, verbatim,
 * from the same origin as the signed-in session (`/api/export` also echoes user-supplied
 * strings, but it builds them into a CSV it composes itself) — so the headers here are the feature's security
 * boundary and not formatting:
 *
 *  - `Content-Type` is the type SNIFFED at upload, re-checked against the allowlist
 *    on the way out. A read-path re-assertion, not paranoia: the same shape as
 *    `isTaxClass` guarding its column, and it means a row written by any future,
 *    looser writer still cannot choose the header this responds with.
 *  - `Content-Disposition: attachment` (never inline) so a PDF cannot be opened as a
 *    top-level document in this origin. Images still preview, because a subresource
 *    load (`<img src=…>`) does not honour the header — asserted in the e2e.
 *  - `nosniff` stops a browser from second-guessing the declared type, and the
 *    `sandbox` CSP means that even if it did, nothing in the file can execute.
 *  - `no-store` keeps a receipt photograph out of the browser's disk cache once the
 *    session ends, which is the same concern that set the 30-minute idle timeout
 *    (O.4). The cost is a re-fetch on every render; a handful of images per page.
 *
 * A file that does not exist and a file belonging to somebody else return the SAME
 * 404, so the response cannot be used to discover which ids are real.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { rateLimitDurable } from '@/server/authz';
import { readAttachmentForUser } from '@/server/attachments';
import { contentDispositionValue, isAttachmentType } from '@/lib/engine/attachments/attachment';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Generous, because one page render legitimately fetches several images; low
  // enough that the route cannot be used to pull a library at speed.
  if (!(await rateLimitDurable(`attachment-read:${userId}`, 120, 60_000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { id } = await context.params;
  const file = await readAttachmentForUser(userId, id);
  if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Re-assert on the READ path. A guard that only runs at creation is advisory.
  const contentType = isAttachmentType(file.mimeType) ? file.mimeType : 'application/octet-stream';

  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(file.bytes.byteLength),
      'Content-Disposition': contentDispositionValue(file.filename),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    },
  });
}
