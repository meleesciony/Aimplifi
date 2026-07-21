'use server';

/**
 * Manual net-worth item actions (DECISIONS #39). Add / update / delete user-owned
 * manual assets and liabilities (stored as Account rows, provider 'manual'). Every
 * mutation is ownership-scoped and guarded to manual rows only — a user can never
 * edit or delete a LINKED (seed/Plaid) account through these. Audit-logged;
 * revalidates the accounts + dashboard net worth.
 *
 * Plus one non-manual deletion (#253/#256): `deleteDisconnectedSyncedAccount`, a
 * thin wrapper over the guarded core in account-delete.ts (SimpleFIN rows only,
 * refused while the connection is live — see that module's docstring).
 */
import { revalidatePath } from 'next/cache';
import { isoDate } from '@/lib/dates';
import { prisma } from '@/lib/db';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { parseManualAccount, parseManualValueCents } from '@/lib/engine/networth/manual';
import { getProvider } from '@/lib/providers/demo';
import { deleteDisconnectedSyncedAccountFor } from '@/server/account-delete';
import { auditLog, requireUserId } from '@/server/authz';

export interface ManualResult {
  ok: boolean;
  errors?: string[];
  id?: string;
}

async function ownedManualAccount(userId: string, accountId: string) {
  const a = await prisma.account.findFirst({ where: { id: accountId, userId } });
  if (!a) throw new Error('Account not found');
  if (a.provider !== 'manual') throw new Error('Only manually-added items can be edited here.');
  return a;
}

export async function addManualAccount(input: { name: string; type: string; value: string }): Promise<ManualResult> {
  const userId = await requireUserId();
  // Demo manual-entry fence (#243 follow-up): a visitor's real name/balance must
  // never land in the shared demo row. Load-bearing for the update/delete paths
  // too — the seed creates no provider='manual' accounts, so with `add` fenced,
  // `ownedManualAccount` can never match a demo-owned manual row.
  if (isDemoUser(userId)) return { ok: false, errors: [DEMO_ENTRY_BLOCKED] };
  const parsed = parseManualAccount(input);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const acct = await prisma.account.create({
    data: {
      userId,
      provider: 'manual',
      name: parsed.account.name,
      type: parsed.account.type,
      currentBalanceCents: parsed.account.currentBalanceCents,
      mask: null,
    },
  });
  await auditLog(userId, 'account.manual.create', {
    id: acct.id,
    type: parsed.account.type,
    currentBalanceCents: parsed.account.currentBalanceCents,
  });
  revalidatePath('/accounts');
  revalidatePath('/dashboard');
  return { ok: true, id: acct.id };
}

export async function updateManualAccountValue(input: { accountId: string; value: string }): Promise<ManualResult> {
  const userId = await requireUserId();
  await ownedManualAccount(userId, input.accountId);
  const v = parseManualValueCents(input.value);
  if (!v.ok) return { ok: false, errors: [v.error] };
  await prisma.account.update({ where: { id: input.accountId }, data: { currentBalanceCents: v.cents } });
  await auditLog(userId, 'account.manual.update', { id: input.accountId, currentBalanceCents: v.cents });
  revalidatePath('/accounts');
  revalidatePath('/dashboard');
  return { ok: true, id: input.accountId };
}

export async function deleteManualAccount(accountId: string): Promise<ManualResult> {
  const userId = await requireUserId();
  await ownedManualAccount(userId, accountId);
  await prisma.account.delete({ where: { id: accountId } });
  await auditLog(userId, 'account.manual.delete', { id: accountId });
  revalidatePath('/accounts');
  revalidatePath('/dashboard');
  return { ok: true };
}

/** Delete a bank-synced (SimpleFIN or Plaid) account after its connection is
 *  disconnected (#253, extended to Plaid in #256). All guards (ownership,
 *  provider, resurrection refusal, demo fence) live in the core so tests and any
 *  future caller inherit them. Revalidates the pages whose numbers the cascade
 *  changes — /transactions too, since the account's transaction history goes
 *  with it. */
export async function deleteDisconnectedSyncedAccount(accountId: string): Promise<ManualResult> {
  const userId = await requireUserId();
  const res = await deleteDisconnectedSyncedAccountFor(userId, accountId, isoDate(getProvider().today(userId)));
  if (res.ok) {
    await auditLog(userId, 'account.synced.delete', { id: accountId });
    revalidatePath('/accounts');
    revalidatePath('/dashboard');
    revalidatePath('/transactions');
  }
  return res;
}
