'use server';

/**
 * The write path for the reader's free-form tags (TASKS O.11d) — added and
 * removed from ONE transaction at a time.
 *
 * Same contract as the sibling flag actions (`transaction-flags-actions.ts`):
 * `{ ok, error }` reported refusals, never a throw for an expected refusal; the
 * server owns every rule the UI merely hints at; the demo fence lives HERE, in
 * the shared action, not per entry point (the L.12c/#242 lesson — fencing each
 * call site is how a fifth call site gets missed). The detail view is today's
 * only entry point; a register chip-popover added later passes through this
 * fence automatically.
 *
 * What a tag is: a label. No figure reads one (schema note at `Tag` in
 * prisma/schema.prisma), so these actions move no money and revalidate only the
 * surfaces that RENDER tags — deliberately not the figure pages. If a tag ever
 * gains authority over a figure, this file is the first place that changes and
 * the revalidation list grows with it, visibly.
 *
 * The case fold lives here and nowhere else: `@@unique([userId, name])` is
 * byte-wise, so "vacation" and "Vacation" are legal distinct rows — and they
 * must stay legal, because the reader's capitalization is theirs. The fold is
 * therefore a WRITER policy: an existing tag whose name differs only in case is
 * APPLIED, not duplicated. The schema stays the last line, not the first: a
 * race that slips two spellings through produces two visible chips (each with a
 * real total), never a hidden wrong figure.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { auditLog, rateLimitDurable, requireUserId } from '@/server/authz';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { validateTagName } from '@/lib/engine/transactions/tags';

export type TagActionResult = { ok: true } | { ok: false; error: string };

/** The surfaces that render tags: the register (chips + toolbar + the tag-filtered
 *  summary). The detail page is a dynamic segment re-fetched on the client's own
 *  reload after every write, and no other surface shows a chip today — if one
 *  starts, this list grows and stays honest about what it covers. */
function revalidateTagViews(): void {
  revalidatePath('/transactions');
}

/** Prisma unique-constraint violation code — the one DB error these actions
 *  handle as a normal outcome rather than an unexpected throw. */
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && 'code' in e &&
    (e as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Apply a tag to a row, creating the reader's tag if no tag of theirs has that
 * name yet — case-insensitively (see the header). Adding a tag the row already
 * carries is a success, not an error: the outcome the reader asked for holds.
 */
export async function addTransactionTag(input: {
  transactionId: string;
  tagName: string;
}): Promise<TagActionResult> {
  const userId = await requireUserId();
  // Shared-demo fence: a visitor minting tags on the shared demo rows would
  // change what every other visitor's register lists and filters. The action
  // refuses; the detail page renders its chips READ-ONLY and says why, so the
  // fence is an explanation on screen, not a dead button.
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  // The one row-CREATING verb of this file gets the repo's durable throttle
  // (authz.ts's rule): every distinct name is a fresh Tag row plus a join plus
  // an audit line, so a scripted flood would bloat three tables and slow the
  // fold's own read. 40 names a minute is far above any hand — a reader adding
  // tags to a batch of rows never sees this.
  if (!(await rateLimitDurable(`txn-tags:${userId}`, 40, 60_000))) {
    return { ok: false, error: 'That was a lot of tags at once — try again in a minute.' };
  }

  if (typeof input.transactionId !== 'string' || input.transactionId.trim() === '') {
    return { ok: false, error: 'That transaction is no longer available — nothing was changed.' };
  }
  const name = validateTagName(String(input.tagName ?? ''));
  if ('error' in name) return { ok: false, error: name.error };

  // Ownership first, and scoped so a foreign id is INDISTINGUISHABLE from a
  // missing one — the same refusal shape as the flags file.
  const row = await prisma.transaction.findFirst({
    where: { id: input.transactionId, account: { userId } },
    select: { id: true },
  });
  if (!row) return { ok: false, error: 'That transaction is no longer available — nothing was changed.' };

  // The fold: one read of the reader's own tags, matched by lower-cased name.
  // Tags are a small per-user list (a register's vocabulary, not a database);
  // folding in JS is what makes the rule identical on SQLite and Postgres,
  // where `mode: 'insensitive'` does not exist on the former.
  const mine = await prisma.tag.findMany({ where: { userId }, select: { id: true, name: true } });
  let tag = mine.find((t) => t.name.toLowerCase() === name.name.toLowerCase());
  if (!tag) {
    try {
      tag = await prisma.tag.create({
        data: { userId, name: name.name },
        select: { id: true, name: true },
      });
    } catch (e) {
      // Race: the reader's other tab minted the same exact name between our find
      // and create. Re-read and use the row that won — never a second chip.
      if (!isUniqueViolation(e)) throw e;
      const winner = await prisma.tag.findFirst({
        where: { userId, name: name.name },
        select: { id: true, name: true },
      });
      if (!winner) throw e;
      tag = winner;
    }
  }

  try {
    await prisma.transactionTag.create({ data: { tagId: tag.id, transactionId: row.id } });
  } catch (e) {
    // Already on the row — the requested outcome holds. (The composite unique
    // makes "apply twice" exactly one row, by construction.)
    if (!isUniqueViolation(e)) throw e;
    return { ok: true };
  }

  await auditLog(userId, 'transaction.tags.add', {
    transactionId: row.id,
    tagId: tag.id,
    name: tag.name,
  });
  revalidateTagViews();
  return { ok: true };
}

/**
 * Remove one tag from one row. Deleting a tag the row does not carry — or one
 * belonging to another user — removes nothing and reports success: the reader's
 * requested state ("this row no longer has that label") holds either way, and
 * no reply distinguishes a foreign tagId from an absent one.
 */
export async function removeTransactionTag(input: {
  transactionId: string;
  tagId: string;
}): Promise<TagActionResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  if (
    typeof input.transactionId !== 'string' || input.transactionId.trim() === '' ||
    typeof input.tagId !== 'string' || input.tagId.trim() === ''
  ) {
    return { ok: false, error: 'That transaction is no longer available — nothing was changed.' };
  }

  const row = await prisma.transaction.findFirst({
    where: { id: input.transactionId, account: { userId } },
    select: { id: true },
  });
  if (!row) return { ok: false, error: 'That transaction is no longer available — nothing was changed.' };

  // The join is deleted only where it connects THIS row to a tag of THIS user.
  // The `tag.userId` scope is the cross-user guard: a guessed foreign tagId
  // matches zero join rows and deletes zero bytes.
  await prisma.transactionTag.deleteMany({
    where: { transactionId: row.id, tagId: input.tagId, tag: { userId } },
  });

  await auditLog(userId, 'transaction.tags.remove', {
    transactionId: row.id,
    tagId: input.tagId,
  });
  revalidateTagViews();
  return { ok: true };
}
