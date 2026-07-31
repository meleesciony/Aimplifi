/**
 * Receipt / document attachments on one transaction — the pure rules.
 *
 * Everything here is a decision about bytes that arrived from a browser, so it is
 * written as a boundary guard rather than a formatter: an attachment is the only
 * user input in this app that is later SERVED BACK over the same origin as the
 * signed-in banking session, which makes "what type is this really" a security
 * question and not a display detail.
 *
 * THE ONE RULE THIS MODULE EXISTS TO ENFORCE: the stored content type is the type
 * SNIFFED from the bytes, never the one the browser declared and never one guessed
 * from the filename. Both of those are attacker-controlled strings, and the type we
 * store is the type we later echo in a `Content-Type` header — so trusting either
 * would let an uploader choose the header a future response carries. The filename is
 * kept as prose for the reader and is never allowed to decide anything.
 *
 * Pure: no I/O, no Prisma, no React. The server route calls `validateAttachment`
 * once and stores exactly what it returns.
 */

/**
 * Per-file ceiling. A phone photo of a receipt is ~1–4 MB, so this admits the real
 * case with headroom while keeping one row's bytes inside a size a serverless
 * function can hold in memory without care. Bytes live in the database (DECISIONS
 * — O.13h), so this cap is also the only thing bounding what one row can add to a
 * backup.
 */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/**
 * Per-transaction ceiling. A charge legitimately has a receipt, an invoice and maybe
 * a warranty card; it does not have fifty. The cap is per transaction rather than
 * per user because that is the unit the reader is looking at when they hit it, so
 * the refusal names something they can act on.
 */
export const MAX_ATTACHMENTS_PER_TRANSACTION = 5;

/**
 * Filename ceiling. Long enough for a real "Costco receipt 2026-01-14.pdf", short
 * enough that the column cannot carry a document, and short enough to render in the
 * detail view without truncation deciding what the reader sees.
 */
export const ATTACHMENT_FILENAME_MAX_CHARS = 120;

/**
 * The closed set of types this app will store and serve.
 *
 * `renderable` is a claim about what a BROWSER will paint inside an `<img>`, not
 * about what is safe: HEIC is a perfectly good photo that Safari itself produced,
 * and no browser will render it in an image tag, so the surface must offer it as a
 * download instead of a preview that silently shows a broken frame. iPhone photo
 * uploads are frequently HEIC, so refusing that type outright would mean the owner's
 * own phone cannot attach its own receipts.
 */
export type AttachmentType = {
  /** The stored + served content type. */
  readonly mime: string;
  /** Human label for the refusal message and the UI. */
  readonly label: string;
  /** True only for types every target browser paints in an `<img>`. */
  readonly renderable: boolean;
};

export const ATTACHMENT_TYPES: readonly AttachmentType[] = [
  { mime: 'image/jpeg', label: 'JPEG image', renderable: true },
  { mime: 'image/png', label: 'PNG image', renderable: true },
  { mime: 'image/gif', label: 'GIF image', renderable: true },
  { mime: 'image/webp', label: 'WebP image', renderable: true },
  { mime: 'image/heic', label: 'HEIC photo (iPhone)', renderable: false },
  { mime: 'application/pdf', label: 'PDF', renderable: false },
] as const;

/** True if this is a type we store — asked of the SNIFFED type, never a declared one. */
export function isAttachmentType(mime: string): boolean {
  return ATTACHMENT_TYPES.some((t) => t.mime === mime);
}

/**
 * True if the browser will paint this in an `<img>`. The detail view asks this
 * instead of assuming "starts with image/", because HEIC does and does not render.
 */
export function isRenderableInline(mime: string): boolean {
  return ATTACHMENT_TYPES.some((t) => t.mime === mime && t.renderable);
}

/** The reader-facing label for a stored type; the raw mime if we somehow stored one we no longer list. */
export function attachmentTypeLabel(mime: string): string {
  return ATTACHMENT_TYPES.find((t) => t.mime === mime)?.label ?? mime;
}

/**
 * The `accept` attribute for the file input, derived from the same set the server
 * enforces so the picker's default filter matches the allowlist.
 *
 * It is a HINT, not a guard: every desktop file dialog offers an "All files" escape,
 * and `accept` is matched against the name/OS type while the server decides from the
 * BYTES — so a `.jpg` that is really something else is offered here and refused there.
 * That divergence is intended; this attribute exists to save a wasted round trip, not
 * to enforce anything.
 */
export function attachmentAcceptAttribute(): string {
  return ATTACHMENT_TYPES.map((t) => t.mime).join(',');
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0));
}

/**
 * ISO base-media brands that mean "this is a HEIF/HEIC still image". `mif1` and
 * `msf1` are the generic image brands Apple also emits; the `hev*`/`hei*` family is
 * the coded-image set. Deliberately does NOT include `mp4`/`isom`/`qt` — a video is
 * not an attachment type this app stores, and admitting one here would store a file
 * we would then serve as `image/heic`.
 */
const HEIF_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevm', 'hevs', 'mif1', 'msf1'];

/**
 * Identify the type from the bytes themselves.
 *
 * Returns null for anything unrecognized, which the caller turns into a refusal —
 * so an unknown file is REJECTED rather than stored with a guessed type. That
 * direction is deliberate: the failure of a false accept is an attacker choosing the
 * `Content-Type` of a response this app serves from its own origin, and the failure
 * of a false reject is a reader being told to convert their file.
 */
export function sniffAttachmentType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'image/gif';
  // WebP is a RIFF container: "RIFF" ....(size).... "WEBP". Both halves must match,
  // because "RIFF" alone is also a WAV file.
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp';
  if (startsWith(bytes, ascii('%PDF-'))) return 'application/pdf';
  // ISO base media: the `ftyp` box sits at offset 4, its major brand at offset 8.
  if (startsWith(bytes, ascii('ftyp'), 4)) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (HEIF_BRANDS.includes(brand)) return 'image/heic';
  }
  return null;
}

export type AttachmentRefusal =
  | 'empty'
  | 'too-large'
  | 'too-many'
  | 'unsupported-type'
  | 'filename-missing'
  | 'filename-too-long'
  | 'filename-unprintable';

/**
 * Reduce a browser-supplied filename to the prose we store, or refuse it.
 *
 * - Path components are STRIPPED, not refused: a directory upload legitimately sends
 *   `receipts/costco.pdf`, and the reader meant the leaf. Both separators are cut
 *   because a Windows client sends backslashes.
 * - Over the cap REFUSES rather than truncating (the `normalizeNote` rule): cutting
 *   the end off silently would also cut off the extension, leaving a name that lies
 *   about what the file is.
 * - Control characters REFUSE. No human types one, and they are exactly what a header
 *   injection looks like — `contentDispositionValue` encodes defensively as well, so
 *   this is the second of two independent guards rather than the only one.
 */
export function normalizeAttachmentFilename(
  raw: string | null | undefined,
): { ok: true; filename: string } | { ok: false; refusal: AttachmentRefusal } {
  const leaf = (raw ?? '').split(/[\\/]/).pop() ?? '';
  const trimmed = leaf.trim();
  if (trimmed.length === 0) return { ok: false, refusal: 'filename-missing' };
  // Checked by CODE POINT, not by a regex character class: a source file that
  // CONTAINS the characters it rejects is one careless copy away from being mangled,
  // and a mangled range widens or narrows the class silently (the L.18 lesson). This
  // form has no literal control byte and no backslash escape to survive a rewrite.
  const hasControlChar = [...trimmed].some((c) => {
    const code = c.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
  if (hasControlChar) return { ok: false, refusal: 'filename-unprintable' };
  // A LONE SURROGATE is printable by this test and makes `encodeURIComponent` throw,
  // which would take out the download route (no try/catch there) and leave the row
  // permanently un-downloadable. Found by the O.13h security critic: the module header
  // claims two independent guards, and that is only true if the first one never admits
  // input the second cannot handle. Not reachable over HTTP today — undici replaces a
  // lone surrogate with U+FFFD during the multipart round trip — so this closes a
  // contract between two functions rather than a live vector.
  if (!trimmed.isWellFormed()) return { ok: false, refusal: 'filename-unprintable' };
  if (trimmed.length > ATTACHMENT_FILENAME_MAX_CHARS) return { ok: false, refusal: 'filename-too-long' };
  return { ok: true, filename: trimmed };
}

export type ValidatedAttachment = {
  readonly filename: string;
  /** The SNIFFED type. The caller stores this and serves it back; nothing else. */
  readonly mimeType: string;
  readonly byteSize: number;
};

/**
 * The single gate every uploaded file passes. One call, one answer: either the exact
 * record to store, or a named refusal.
 *
 * Order is deliberate. The per-transaction cap is checked FIRST because it is the one
 * refusal no change to the file can clear — telling someone their file is unsupported
 * when nothing they upload could be accepted would send them away to convert a file
 * for nothing.
 */
export function validateAttachment(input: {
  filename: string | null | undefined;
  bytes: Uint8Array;
  /** How many attachments this transaction already has. */
  existingCount: number;
}): { ok: true; attachment: ValidatedAttachment } | { ok: false; refusal: AttachmentRefusal } {
  if (input.existingCount >= MAX_ATTACHMENTS_PER_TRANSACTION) {
    return { ok: false, refusal: 'too-many' };
  }
  if (input.bytes.length === 0) return { ok: false, refusal: 'empty' };
  if (input.bytes.length > MAX_ATTACHMENT_BYTES) return { ok: false, refusal: 'too-large' };

  const name = normalizeAttachmentFilename(input.filename);
  if (!name.ok) return name;

  const mimeType = sniffAttachmentType(input.bytes);
  if (mimeType === null) return { ok: false, refusal: 'unsupported-type' };

  return {
    ok: true,
    attachment: { filename: name.filename, mimeType, byteSize: input.bytes.length },
  };
}

/**
 * The message a reader sees. One author, so the control, the route and the test
 * cannot disagree about what the limit is — and every message says what happened to
 * the file, because "nothing was saved" is the fact a reader needs before they decide
 * whether to try again.
 */
export function attachmentRefusalMessage(refusal: AttachmentRefusal): string {
  switch (refusal) {
    case 'empty':
      return 'That file is empty — nothing was saved.';
    case 'too-large':
      return `That file is larger than ${formatAttachmentSize(MAX_ATTACHMENT_BYTES)} — nothing was saved. Try a smaller scan or photo.`;
    case 'too-many':
      return `This transaction already has ${MAX_ATTACHMENTS_PER_TRANSACTION} files, which is the limit — nothing was saved. Remove one to add another.`;
    case 'unsupported-type':
      return `Aimplifi stores ${ATTACHMENT_TYPES.map((t) => t.label).join(', ')} — that file is none of those, so nothing was saved.`;
    case 'filename-missing':
      return 'That file arrived without a name — nothing was saved.';
    case 'filename-too-long':
      return `That file's name is longer than ${ATTACHMENT_FILENAME_MAX_CHARS} characters — nothing was saved. Rename it and try again.`;
    case 'filename-unprintable':
      return "That file's name contains characters Aimplifi cannot store — nothing was saved. Rename it and try again.";
  }
}

/**
 * Build the `Content-Disposition` header value for a stored attachment.
 *
 * Written as a builder rather than a template at the call site because a filename is
 * reader-supplied text going into an HTTP header, which is the textbook response-
 * splitting / header-injection shape. Two independent protections, both here:
 *
 * 1. The ASCII fallback is built from a strict ALLOWLIST of characters, so a quote,
 *    a semicolon, a backslash, a CR or an LF cannot survive into the quoted string —
 *    it is not a blocklist that a new escape can walk past.
 * 2. The RFC 5987 `filename*` form carries the real (possibly non-ASCII) name
 *    percent-encoded, which has no character that can terminate the header.
 *
 * `attachment` — never `inline` — because a PDF or an SVG-like payload rendered as a
 * top-level document would run in this app's own origin. Images are still previewed:
 * a subresource load (`<img src=…>`) does not honour Content-Disposition, which is
 * asserted in the e2e rather than assumed.
 */
export function contentDispositionValue(filename: string): string {
  const asciiFallback = [...filename]
    .map((c) => (/[A-Za-z0-9._ -]/.test(c) ? c : '_'))
    .join('')
    .trim();
  // A name written entirely in a non-Latin script neutralizes to nothing but
  // underscores, which is not a filename — fall back to a word rather than hand a
  // legacy client "__". Modern clients read `filename*` and never see this.
  const safeFallback = /[A-Za-z0-9]/.test(asciiFallback) ? asciiFallback : 'attachment';
  // encodeURIComponent leaves !'()* unescaped, and RFC 5987's attr-char set excludes
  // them, so they are encoded explicitly rather than left to a reader of the spec.
  const encoded = encodeURIComponent(filename).replace(
    /['()!*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${safeFallback}"; filename*=UTF-8''${encoded}`;
}

/** "1.4 MB" / "812 KB" — for the file list beside each name. */
export function formatAttachmentSize(byteSize: number): string {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${Math.round(byteSize / 1024)} KB`;
  return `${Math.round((byteSize / (1024 * 1024)) * 10) / 10} MB`;
}
