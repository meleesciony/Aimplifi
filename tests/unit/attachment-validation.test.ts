/**
 * The attachment boundary guard (O.13h).
 *
 * These are mostly REFUSAL tests on purpose. An attachment is the only user input
 * this app stores as raw bytes and later serves back over the same origin as the
 * signed-in session, so the interesting behaviour is everything the module declines
 * to store — a happy path that accepts a JPEG proves almost nothing about a module
 * whose job is to be the thing that says no.
 *
 * Two properties carry the security weight and each is asserted by mutation-relevant
 * cases rather than by one example:
 *   1. The stored type comes from the BYTES, never from the browser's declaration or
 *      the filename extension (both attacker-controlled, both echoed nowhere).
 *   2. A filename cannot inject anything into the `Content-Disposition` header.
 */
import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_FILENAME_MAX_CHARS,
  ATTACHMENT_TYPES,
  MAX_ATTACHMENTS_PER_TRANSACTION,
  MAX_ATTACHMENT_BYTES,
  attachmentRefusalMessage,
  attachmentTypeLabel,
  contentDispositionValue,
  formatAttachmentSize,
  isAttachmentType,
  isRenderableInline,
  normalizeAttachmentFilename,
  sniffAttachmentType,
  validateAttachment,
} from '@/lib/engine/attachments/attachment';

/** Real leading bytes for each format, written as bytes rather than copied from a file. */
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const GIF = Uint8Array.from([...'GIF89a'].map((c) => c.charCodeAt(0)).concat([1, 2, 3]));
const PDF = Uint8Array.from([...'%PDF-1.7'].map((c) => c.charCodeAt(0)));

function riff(tag: string): Uint8Array {
  const head = [...'RIFF'].map((c) => c.charCodeAt(0));
  const size = [0x10, 0x00, 0x00, 0x00];
  const body = [...tag].map((c) => c.charCodeAt(0));
  return Uint8Array.from([...head, ...size, ...body, 0, 0, 0, 0]);
}

function isoBaseMedia(brand: string): Uint8Array {
  const boxSize = [0x00, 0x00, 0x00, 0x18];
  const ftyp = [...'ftyp'].map((c) => c.charCodeAt(0));
  const brandBytes = [...brand].map((c) => c.charCodeAt(0));
  return Uint8Array.from([...boxSize, ...ftyp, ...brandBytes, 0, 0, 0, 0]);
}

describe('sniffAttachmentType — the type comes from the bytes', () => {
  it('identifies each format this app stores', () => {
    expect(sniffAttachmentType(JPEG)).toBe('image/jpeg');
    expect(sniffAttachmentType(PNG)).toBe('image/png');
    expect(sniffAttachmentType(GIF)).toBe('image/gif');
    expect(sniffAttachmentType(riff('WEBP'))).toBe('image/webp');
    expect(sniffAttachmentType(PDF)).toBe('application/pdf');
    expect(sniffAttachmentType(isoBaseMedia('heic'))).toBe('image/heic');
    expect(sniffAttachmentType(isoBaseMedia('mif1'))).toBe('image/heic');
  });

  it('refuses a RIFF container that is not WebP — "RIFF" alone is also a WAV', () => {
    expect(sniffAttachmentType(riff('WAVE'))).toBeNull();
  });

  it('refuses an ISO base-media file that is a VIDEO, not a still image', () => {
    // The same `ftyp` box shape as HEIC. If the brand check were dropped, an MP4
    // would be stored and later served with `Content-Type: image/heic`.
    expect(sniffAttachmentType(isoBaseMedia('isom'))).toBeNull();
    expect(sniffAttachmentType(isoBaseMedia('mp42'))).toBeNull();
  });

  it('refuses anything unrecognized rather than guessing a type', () => {
    expect(sniffAttachmentType(Uint8Array.from([]))).toBeNull();
    expect(sniffAttachmentType(Uint8Array.from([0x00]))).toBeNull();
    expect(
      sniffAttachmentType(Uint8Array.from([...'<html><script>'].map((c) => c.charCodeAt(0)))),
    ).toBeNull();
    // An SVG is an image to a human and an executable document to a browser.
    expect(sniffAttachmentType(Uint8Array.from([...'<svg xmlns='].map((c) => c.charCodeAt(0))))).toBeNull();
  });

  it('does not read past the end of a truncated file', () => {
    // Four bytes of a would-be `ftyp` box: the brand read must not throw or match.
    expect(sniffAttachmentType(Uint8Array.from([0, 0, 0, 0x18]))).toBeNull();
    expect(sniffAttachmentType(Uint8Array.from([0xff, 0xd8]))).toBeNull();
  });
});

describe('validateAttachment', () => {
  const ok = { filename: 'receipt.jpg', bytes: JPEG, existingCount: 0 };

  it('stores the sniffed type, and the filename extension never decides it', () => {
    // The name says PDF and the bytes are a JPEG. The bytes win, because the stored
    // type is what a later response echoes in its Content-Type header.
    const result = validateAttachment({ ...ok, filename: 'totally-a-receipt.pdf' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attachment.mimeType).toBe('image/jpeg');
    expect(result.attachment.filename).toBe('totally-a-receipt.pdf');
    expect(result.attachment.byteSize).toBe(JPEG.length);
  });

  it('refuses an empty file', () => {
    const result = validateAttachment({ ...ok, bytes: Uint8Array.from([]) });
    expect(result).toEqual({ ok: false, refusal: 'empty' });
  });

  it('refuses a file over the size cap', () => {
    const big = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    big.set(JPEG, 0);
    expect(validateAttachment({ ...ok, bytes: big })).toEqual({ ok: false, refusal: 'too-large' });
  });

  it('accepts a file exactly AT the cap — the boundary is inclusive', () => {
    const exact = new Uint8Array(MAX_ATTACHMENT_BYTES);
    exact.set(JPEG, 0);
    expect(validateAttachment({ ...ok, bytes: exact }).ok).toBe(true);
  });

  it('refuses an unsupported type', () => {
    const text = Uint8Array.from([...'just some text'].map((c) => c.charCodeAt(0)));
    expect(validateAttachment({ ...ok, bytes: text })).toEqual({
      ok: false,
      refusal: 'unsupported-type',
    });
  });

  it('reports the per-transaction cap BEFORE anything about the file', () => {
    // Deliberate ordering: at the cap no file can be accepted, so naming a fixable
    // problem with this file would send the reader away to fix the wrong thing.
    const atCap = { ...ok, existingCount: MAX_ATTACHMENTS_PER_TRANSACTION };
    expect(validateAttachment(atCap)).toEqual({ ok: false, refusal: 'too-many' });
    expect(validateAttachment({ ...atCap, bytes: Uint8Array.from([1, 2, 3]) })).toEqual({
      ok: false,
      refusal: 'too-many',
    });
  });

  it('accepts the last slot below the cap', () => {
    expect(
      validateAttachment({ ...ok, existingCount: MAX_ATTACHMENTS_PER_TRANSACTION - 1 }).ok,
    ).toBe(true);
  });
});

describe('normalizeAttachmentFilename', () => {
  it('keeps the leaf of a path from either platform', () => {
    expect(normalizeAttachmentFilename('receipts/2026/costco.pdf')).toEqual({
      ok: true,
      filename: 'costco.pdf',
    });
    expect(normalizeAttachmentFilename('C:\\Users\\me\\costco.pdf')).toEqual({
      ok: true,
      filename: 'costco.pdf',
    });
  });

  it('refuses an empty or whitespace-only name rather than inventing one', () => {
    expect(normalizeAttachmentFilename('')).toEqual({ ok: false, refusal: 'filename-missing' });
    expect(normalizeAttachmentFilename('   ')).toEqual({ ok: false, refusal: 'filename-missing' });
    expect(normalizeAttachmentFilename(null)).toEqual({ ok: false, refusal: 'filename-missing' });
    expect(normalizeAttachmentFilename('folder/')).toEqual({ ok: false, refusal: 'filename-missing' });
  });

  it('REFUSES an over-long name instead of truncating it', () => {
    // Truncating would also cut the extension off, leaving a stored name that lies
    // about what the file is (the `normalizeNote` rule).
    const long = `${'a'.repeat(ATTACHMENT_FILENAME_MAX_CHARS)}.pdf`;
    expect(normalizeAttachmentFilename(long)).toEqual({ ok: false, refusal: 'filename-too-long' });
    const atLimit = 'a'.repeat(ATTACHMENT_FILENAME_MAX_CHARS);
    expect(normalizeAttachmentFilename(atLimit)).toEqual({ ok: true, filename: atLimit });
  });

  it('refuses control characters anywhere in the name', () => {
    const cr = String.fromCharCode(13);
    const lf = String.fromCharCode(10);
    const nul = String.fromCharCode(0);
    const del = String.fromCharCode(127);
    for (const bad of [cr, lf, nul, del]) {
      expect(normalizeAttachmentFilename(`receipt${bad}.pdf`)).toEqual({
        ok: false,
        refusal: 'filename-unprintable',
      });
    }
  });

  it('keeps a non-ASCII name as the reader typed it', () => {
    expect(normalizeAttachmentFilename('reçu café 2026.pdf')).toEqual({
      ok: true,
      filename: 'reçu café 2026.pdf',
    });
  });
});

describe('contentDispositionValue — a filename cannot reach the header', () => {
  it('always disposes as an attachment, never inline', () => {
    // A PDF rendered as a top-level document runs in this app's own origin.
    expect(contentDispositionValue('receipt.pdf').startsWith('attachment;')).toBe(true);
  });

  it('neutralizes quotes, semicolons and backslashes in the ASCII fallback', () => {
    const nasty = 'a";x=y.pdf';
    const header = contentDispositionValue(nasty);
    const quoted = header.slice(header.indexOf('"') + 1, header.indexOf('";'));
    expect(quoted).not.toContain('"');
    expect(quoted).not.toContain(';');
    expect(quoted).not.toContain('\\');
  });

  it('cannot emit a raw CR or LF even when the name carries one', () => {
    // Defence in depth: `normalizeAttachmentFilename` already refuses these, so this
    // asserts the builder is safe on its own rather than safe because of its caller.
    const header = contentDispositionValue(
      `evil${String.fromCharCode(13)}${String.fromCharCode(10)}X-Injected: 1.pdf`,
    );
    expect(header).not.toContain(String.fromCharCode(13));
    expect(header).not.toContain(String.fromCharCode(10));
  });

  it('carries a non-ASCII name in the RFC 5987 form', () => {
    const header = contentDispositionValue('reçu.pdf');
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain('re%C3%A7u.pdf');
    // The ASCII fallback holds no raw non-ASCII byte.
    const fallback = header.slice(header.indexOf('"') + 1, header.indexOf('";'));
    expect([...fallback].every((c) => c.charCodeAt(0) < 128)).toBe(true);
  });

  it("encodes the characters encodeURIComponent leaves alone (!'()*)", () => {
    const header = contentDispositionValue("re'ceipt!(1)*.pdf");
    // Slice PAST the delimiter: `UTF-8''` contains apostrophes of its own, so
    // including it would fail this assertion on the syntax rather than the name.
    const star = header.slice(header.indexOf("UTF-8''") + "UTF-8''".length);
    for (const raw of ["'", '(', ')', '!', '*']) {
      expect(star).not.toContain(raw);
    }
  });

  it('falls back to a usable name when nothing ASCII survives', () => {
    expect(contentDispositionValue('收據')).toContain('filename="attachment"');
  });
});

describe('the type table', () => {
  it('renders inline only what a browser paints in an <img>', () => {
    expect(isRenderableInline('image/jpeg')).toBe(true);
    expect(isRenderableInline('image/png')).toBe(true);
    // Both stored, neither renderable: a PDF is a document and no browser paints
    // HEIC in an image tag, so the surface must offer a download instead of a
    // preview that shows a silently broken frame.
    expect(isRenderableInline('application/pdf')).toBe(false);
    expect(isRenderableInline('image/heic')).toBe(false);
    expect(isRenderableInline('image/svg+xml')).toBe(false);
  });

  it('agrees with itself about what is stored', () => {
    for (const type of ATTACHMENT_TYPES) {
      expect(isAttachmentType(type.mime)).toBe(true);
      expect(attachmentTypeLabel(type.mime)).toBe(type.label);
      if (type.renderable) expect(isRenderableInline(type.mime)).toBe(true);
    }
    expect(isAttachmentType('text/html')).toBe(false);
    expect(isAttachmentType('image/svg+xml')).toBe(false);
  });

  it('every refusal has a message that says nothing was saved', () => {
    const refusals = [
      'empty',
      'too-large',
      'too-many',
      'unsupported-type',
      'filename-missing',
      'filename-too-long',
      'filename-unprintable',
    ] as const;
    for (const refusal of refusals) {
      expect(attachmentRefusalMessage(refusal)).toContain('nothing was saved');
    }
  });
});

describe('formatAttachmentSize', () => {
  it('reads as a person would say it', () => {
    expect(formatAttachmentSize(512)).toBe('512 B');
    expect(formatAttachmentSize(2048)).toBe('2 KB');
    expect(formatAttachmentSize(1_500_000)).toBe('1.4 MB');
  });
});
