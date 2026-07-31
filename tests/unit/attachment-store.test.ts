/**
 * Attachments end to end through real Prisma (O.13h): the upload route, the
 * download route, the delete action, and the deletion GUARANTEE.
 *
 * Three properties carry this feature, and each is asserted against the database
 * rather than reasoned about:
 *
 *  1. **Ownership.** Reaching another user's attachment answers exactly as reaching
 *     one that does not exist — the same 404, so an id cannot be probed.
 *  2. **Deletion is complete.** `docs/DATA_RETENTION_AND_DISPOSAL.md` §3 promises
 *     that deleting the user removes everything. That promise is the reason the
 *     bytes are in this database at all, so it is asserted at the strongest level:
 *     delete the USER, then count the blobs.
 *  3. **The bytes survive the round trip byte-for-byte** through the driver adapter.
 *     A binary column is new to this schema; nothing else here stores one.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// `vi.hoisted` because vi.mock's factory is lifted above every top-level const.
const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('@/auth', () => ({ auth, signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { POST } from '@/app/api/attachments/route';
import { GET } from '@/app/api/attachments/[id]/route';
import { deleteTransactionAttachment } from '@/server/attachment-actions';
import {
  countAttachmentsForTransaction,
  listAttachmentsForTransaction,
  readAttachmentForUser,
} from '@/server/attachments';
import { MAX_ATTACHMENTS_PER_TRANSACTION } from '@/lib/engine/attachments/attachment';
import { DEMO_USER_ID } from '@/lib/demo-user';
import { prisma } from '@/lib/db';

const OWNER = `att-owner-${Date.now()}-${process.pid}`;
const STRANGER = `att-stranger-${Date.now()}-${process.pid}`;

let ownerTxnId = '';
let strangerTxnId = '';

/** A real JPEG's leading bytes plus a distinctive tail, so a round trip is provable. */
// `new Uint8Array([...])`, not `Uint8Array.from(...)`: the latter is typed over
// ArrayBufferLike, which `File` will not accept as a BlobPart.
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0xfe, 0x00, 0xff]);

function jpegFile(name = 'receipt.jpg', bytes: Uint8Array<ArrayBuffer> = JPEG_BYTES): File {
  return new File([bytes], name, { type: 'image/jpeg' });
}

function uploadRequest(form: FormData): NextRequest {
  return new NextRequest('http://localhost/api/attachments', {
    method: 'POST',
    body: form,
    // Same-origin, as a browser sends: the route compares Origin to Host.
    headers: { origin: 'http://localhost', host: 'localhost' },
  });
}

async function upload(transactionId: string, file: File) {
  const form = new FormData();
  form.set('transactionId', transactionId);
  form.set('file', file);
  const res = await POST(uploadRequest(form));
  return { status: res.status, body: (await res.json()) as { ok?: boolean; error?: string; attachment?: { id: string } } };
}

async function seedUser(userId: string): Promise<string> {
  await prisma.user.create({ data: { id: userId, email: `${userId}@example.test` } });
  const account = await prisma.account.create({
    data: {
      userId,
      name: 'Checking',
      type: 'CHECKING',
      currentBalanceCents: 100_00,
      currency: 'USD',
      provider: 'manual',
    },
  });
  const txn = await prisma.transaction.create({
    data: {
      accountId: account.id,
      date: '2026-01-15',
      amountCents: -4_200,
      rawDescriptor: 'COSTCO WHSE #1234',
    },
  });
  return txn.id;
}

beforeAll(async () => {
  ownerTxnId = await seedUser(OWNER);
  strangerTxnId = await seedUser(STRANGER);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [OWNER, STRANGER] } } });
});

beforeEach(async () => {
  await prisma.transactionAttachment.deleteMany({
    where: { transaction: { account: { userId: { in: [OWNER, STRANGER] } } } },
  });
  auth.mockReset();
  auth.mockResolvedValue({ user: { id: OWNER } });
});

describe('upload', () => {
  it('stores the file and returns its metadata', async () => {
    const { status, body } = await upload(ownerTxnId, jpegFile());
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(await countAttachmentsForTransaction(OWNER, ownerTxnId)).toBe(1);
  });

  it('round-trips the bytes exactly', async () => {
    await upload(ownerTxnId, jpegFile());
    const [listed] = await listAttachmentsForTransaction(OWNER, ownerTxnId);
    const file = await readAttachmentForUser(OWNER, listed.id);
    expect(file).not.toBeNull();
    // Byte for byte, not "same length": a driver that mangled the buffer would
    // still return the right size.
    expect(Array.from(file!.bytes)).toEqual(Array.from(JPEG_BYTES));
  });

  it('stores the SNIFFED type, not the type the client declared', async () => {
    // A browser (or a hostile client) says PDF; the bytes are a JPEG. The stored
    // type is what the download route later echoes as Content-Type, so the bytes win.
    const lying = new File([JPEG_BYTES], 'invoice.pdf', { type: 'application/pdf' });
    await upload(ownerTxnId, lying);
    const [listed] = await listAttachmentsForTransaction(OWNER, ownerTxnId);
    expect(listed.mimeType).toBe('image/jpeg');
  });

  it('refuses a type it does not store, whatever the name says', async () => {
    const html = new File([new TextEncoder().encode('<html><script>alert(1)</script>')], 'receipt.jpg', {
      type: 'image/jpeg',
    });
    const { status, body } = await upload(ownerTxnId, html);
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(await countAttachmentsForTransaction(OWNER, ownerTxnId)).toBe(0);
  });

  it("refuses to attach to somebody else's transaction, and says only that it is unavailable", async () => {
    const { status, body } = await upload(strangerTxnId, jpegFile());
    expect(status).toBe(404);
    expect(body.error).toContain('no longer available');
    // Nothing was written to the stranger's row.
    expect(await countAttachmentsForTransaction(STRANGER, strangerTxnId)).toBe(0);
  });

  it('refuses an unauthenticated upload', async () => {
    auth.mockResolvedValue(null);
    const { status } = await upload(ownerTxnId, jpegFile());
    expect(status).toBe(401);
  });

  it('refuses a cross-origin post', async () => {
    const form = new FormData();
    form.set('transactionId', ownerTxnId);
    form.set('file', jpegFile());
    const res = await POST(
      new NextRequest('http://localhost/api/attachments', {
        method: 'POST',
        body: form,
        headers: { origin: 'http://evil.example', host: 'localhost' },
      }),
    );
    expect(res.status).toBe(403);
    expect(await countAttachmentsForTransaction(OWNER, ownerTxnId)).toBe(0);
  });

  it('fences the shared demo account', async () => {
    // The demo is one row every anonymous visitor shares, so a receipt uploaded
    // there would be handed to the next visitor.
    auth.mockResolvedValue({ user: { id: DEMO_USER_ID } });
    const { status, body } = await upload(ownerTxnId, jpegFile());
    expect(status).toBe(403);
    expect(body.error).toContain('shared account');
  });

  it('enforces the per-transaction cap', async () => {
    for (let i = 0; i < MAX_ATTACHMENTS_PER_TRANSACTION; i += 1) {
      const { status } = await upload(ownerTxnId, jpegFile(`receipt-${i}.jpg`));
      expect(status).toBe(200);
    }
    const { status, body } = await upload(ownerTxnId, jpegFile('one-too-many.jpg'));
    expect(status).toBe(400);
    expect(body.error).toContain('limit');
    expect(await countAttachmentsForTransaction(OWNER, ownerTxnId)).toBe(
      MAX_ATTACHMENTS_PER_TRANSACTION,
    );
  });
});

describe('download', () => {
  async function get(userId: string | null, attachmentId: string) {
    auth.mockResolvedValue(userId ? { user: { id: userId } } : null);
    return GET(new NextRequest(`http://localhost/api/attachments/${attachmentId}`), {
      params: Promise.resolve({ id: attachmentId }),
    });
  }

  it('serves the owner their own file, with headers that cannot be re-purposed', async () => {
    await upload(ownerTxnId, jpegFile('reçu café.jpg'));
    const [listed] = await listAttachmentsForTransaction(OWNER, ownerTxnId);

    const res = await get(OWNER, listed.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(res.headers.get('cache-control')).toContain('no-store');
    // Never `inline`: a document opened as a top-level page would run in this origin.
    expect(res.headers.get('content-disposition')).toContain('attachment;');
    expect(res.headers.get('content-disposition')).toContain("filename*=UTF-8''");
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(JPEG_BYTES));
  });

  it("answers for somebody else's file exactly as for one that does not exist", async () => {
    await upload(ownerTxnId, jpegFile());
    const [listed] = await listAttachmentsForTransaction(OWNER, ownerTxnId);

    const asStranger = await get(STRANGER, listed.id);
    const madeUp = await get(STRANGER, 'clzzzzzzzzzzzzzzzzzzzzzzz');
    expect(asStranger.status).toBe(404);
    expect(madeUp.status).toBe(404);
    // Identical bodies too — a different message would confirm the id is real.
    expect(await asStranger.json()).toEqual(await madeUp.json());
  });

  it('refuses an unauthenticated read', async () => {
    await upload(ownerTxnId, jpegFile());
    const [listed] = await listAttachmentsForTransaction(OWNER, ownerTxnId);
    expect((await get(null, listed.id)).status).toBe(401);
  });
});

describe('deletion is complete', () => {
  async function blobCount(userId: string): Promise<number> {
    return prisma.attachmentBlob.count({
      where: { attachment: { transaction: { account: { userId } } } },
    });
  }

  it('removing one attachment removes its bytes', async () => {
    await upload(ownerTxnId, jpegFile());
    const [listed] = await listAttachmentsForTransaction(OWNER, ownerTxnId);
    expect(await blobCount(OWNER)).toBe(1);

    expect(await deleteTransactionAttachment({ attachmentId: listed.id })).toEqual({ ok: true });
    expect(await blobCount(OWNER)).toBe(0);
    expect(await listAttachmentsForTransaction(OWNER, ownerTxnId)).toEqual([]);
  });

  it("will not delete somebody else's attachment", async () => {
    await upload(ownerTxnId, jpegFile());
    const [listed] = await listAttachmentsForTransaction(OWNER, ownerTxnId);

    auth.mockResolvedValue({ user: { id: STRANGER } });
    const result = await deleteTransactionAttachment({ attachmentId: listed.id });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('no longer available') });
    expect(await blobCount(OWNER)).toBe(1);
  });

  it('deleting the TRANSACTION takes the file with it', async () => {
    const txn = await prisma.transaction.create({
      data: {
        accountId: (await prisma.account.findFirstOrThrow({ where: { userId: OWNER } })).id,
        date: '2026-02-01',
        amountCents: -900,
        rawDescriptor: 'TEMP ROW',
      },
    });
    await upload(txn.id, jpegFile());
    expect(await blobCount(OWNER)).toBe(1);

    await prisma.transaction.delete({ where: { id: txn.id } });
    expect(await blobCount(OWNER)).toBe(0);
  });

  it('deleting the USER leaves nothing behind — the promise the retention policy makes', async () => {
    // This is the assertion that justifies storing bytes in this database at all.
    const doomedTxn = await seedUser(`att-doomed-${Date.now()}-${process.pid}`);
    const doomedUserId = (
      await prisma.account.findFirstOrThrow({
        where: { transactions: { some: { id: doomedTxn } } },
        select: { userId: true },
      })
    ).userId;
    auth.mockResolvedValue({ user: { id: doomedUserId } });
    await upload(doomedTxn, jpegFile());
    expect(await blobCount(doomedUserId)).toBe(1);

    await prisma.user.delete({ where: { id: doomedUserId } });

    // Counted GLOBALLY, not through the (now-deleted) ownership join: a blob whose
    // parent rows are gone would be invisible to a scoped count and still be
    // sitting in the table. That is exactly the orphan an object store would leave.
    const orphans = await prisma.attachmentBlob.count();
    const orphanAttachments = await prisma.transactionAttachment.count({
      where: { transaction: { accountId: { in: [] } } },
    });
    expect(orphans).toBe(0);
    expect(orphanAttachments).toBe(0);
  });
});
