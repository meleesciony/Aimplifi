'use server';

/**
 * Account deletion (ROADMAP #10, docs/PRIVACY.md §Deletion). Session-verified,
 * typed-confirmation gated, and ownership-scoped: a single `prisma.user.delete`
 * cascades every user-owned row (accounts → transactions/statements/etc., plus
 * rules, corrections, recurring series, goals, budgets, audit log, Plaid items)
 * because each relation is `onDelete: Cascade`. Shared reference data (the system
 * Category set, the global Merchant table) is not user-scoped and is left intact.
 * Irreversible — and not exercised by e2e against the shared demo user.
 */
import { signOut } from '@/auth';
import { prisma } from '@/lib/db';
import { confirmationMatches } from '@/lib/engine/account/deletion';
import { getProvider } from '@/lib/providers/demo';
import { auditLog, requireUserId } from '@/server/authz';

export async function deleteMyData(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  if (!confirmationMatches(String(formData.get('confirm') ?? ''))) {
    throw new Error('Type the confirmation phrase exactly to delete your data');
  }

  // Idempotent: if the row is already gone (double-submit, a stale session after
  // a prior delete, or a migrated-but-unseeded deploy) there is nothing to wipe —
  // just sign out. This avoids an unhandled FK / record-not-found 500 on the one
  // action a worried user most needs to trust (mirrors deleteGoal's defensive
  // deleteMany), and keeps the audit write from failing the User FK.
  const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (exists) {
    // Best-effort: revoke any linked Plaid tokens at the source BEFORE the local
    // wipe (PRIVACY.md step 2). Demo has no PlaidItems → no-op. A Plaid failure
    // must never block the user's right to delete, so each call is try/caught.
    const items = await prisma.plaidItem.findMany({ where: { userId }, select: { itemId: true } });
    if (items.length > 0) {
      const provider = getProvider() as { removeItem?: (u: string, i: string) => Promise<void> };
      if (typeof provider.removeItem === 'function') {
        for (const it of items) {
          try {
            await provider.removeItem(userId, it.itemId);
          } catch {
            // proceed — local rows (incl. the encrypted token) are wiped below regardless
          }
        }
      }
    }

    await auditLog(userId, 'account.delete', { plaidItems: items.length });
    // The cascade removes everything personal, the audit row included — per
    // PRIVACY.md, nothing about the user is retained.
    await prisma.user.delete({ where: { id: userId } });
  }

  await signOut({ redirectTo: '/sign-in' });
}
