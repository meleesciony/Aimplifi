'use server';

/**
 * Rename an account (TASKS L.7, owner-requested 2026-07-24: *"there should be a way to edit
 * name of accounts myself. Similar to simplifi.com."*).
 *
 * Writes `Account.displayName` and nothing else. It never touches `name` — the feed rewrites
 * that column on every sync, so a rename written there would be silently reverted by the next
 * cron, and every identity comparison in the app is built on the string the bank sent.
 *
 * Works on ANY account the user owns, linked or manual: the three cards his bank all calls
 * `CREDIT CARD` are exactly the rows that need it. `type` is deliberately NOT editable here
 * even though Quicken Simplifi edits both — type drives the net-worth classifier and the
 * cash-needed engine, so changing it is a money change wearing a label's clothes, and it gets
 * its own slice with its own critic pass (DECISIONS #308).
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { ACCOUNT_NOT_FOUND, parseAccountNickname } from '@/lib/engine/account/display-name';
import { auditLog, rateLimitDurable, requireUserId } from '@/server/authz';

export interface RenameResult {
  ok: boolean;
  errors?: string[];
  /** The label the row will now render — the new nickname, or the feed name once cleared. */
  label?: string;
}

export async function renameAccount(input: { accountId: string; name: string }): Promise<RenameResult> {
  const userId = await requireUserId();
  // Demo fence, same reason as every other write path (#243, and the #226 lesson about the
  // shared demo row LEARNING): the demo user is one row set shared by every visitor, so one
  // visitor's nickname would greet the next one.
  if (isDemoUser(userId)) return { ok: false, errors: [DEMO_ENTRY_BLOCKED] };
  // Every call writes an audit row, so the endpoint is bounded like the comparable writes
  // (combine 6/min, card statements 10/min). Renaming several accounts in one sitting is
  // ordinary, so the ceiling is higher than either.
  if (!(await rateLimitDurable(`rename:${userId}`, 20, 60_000))) {
    return { ok: false, errors: ['Too many renames just now — try again in a minute.'] };
  }

  // A `'use server'` endpoint is directly POST-able, so refuse non-scalar args before any
  // query (the rule this repo states verbatim at reconciliation.ts:110). Without this,
  // `parseAccountNickname` calls `.normalize()` on a number and throws a 500 instead of
  // returning a refusal, and a non-string id reaches Prisma.
  if (typeof input.accountId !== 'string' || typeof input.name !== 'string') {
    return { ok: false, errors: [ACCOUNT_NOT_FOUND] };
  }

  const parsed = parseAccountNickname(input.name);
  if (!parsed.ok) return { ok: false, errors: [parsed.error] };

  // Ownership scope in the WHERE clause, not a fetch-then-check: an account belonging to
  // someone else is simply not found here.
  const account = await prisma.account.findFirst({
    where: { id: input.accountId, userId },
    select: { id: true, name: true },
  });
  if (!account) return { ok: false, errors: [ACCOUNT_NOT_FOUND] };

  await prisma.account.update({ where: { id: account.id }, data: { displayName: parsed.value } });
  // The audit row records THAT he renamed it and whether he cleared it — never the string.
  // A nickname is free text a person chose for his own money ("Mom's inheritance"), and the
  // audit log has no reason to hold it.
  await auditLog(userId, 'account.rename', {
    id: account.id,
    cleared: parsed.value === null,
    length: parsed.value === null ? 0 : [...parsed.value].length,
  });

  // Every page that paints an account name.
  revalidatePath('/accounts');
  revalidatePath('/dashboard');
  revalidatePath('/cards');
  revalidatePath('/calendar');
  revalidatePath('/transactions');
  revalidatePath('/investments');
  revalidatePath('/coach');
  return { ok: true, label: parsed.value ?? account.name };
}
