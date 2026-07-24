'use server';

/**
 * Combine two live Plaid connections pulling the same account — server-action wrapper
 * (TASKS L.6 / L.10; docs/ACCOUNT_IDENTITY_ARCHITECTURE.md §4 layer 3).
 *
 * Thin `'use server'` shell over the NextAuth-free core: resolve the session user, inject the
 * provider `today` and the real disconnect, then delegate. The disconnect is injected rather
 * than imported by the core so the core is testable against real Prisma with no live Plaid.
 */
import { revalidatePath } from 'next/cache';
import { businessToday } from '@/lib/business-today';
import { PlaidProvider } from '@/lib/providers/plaid';
import { auditLog, rateLimitDurable, requireUserId } from '@/server/authz';
import {
  type CombineConnectionsInput,
  type CombineConnectionsResult,
  combineDuplicateConnectionsFor,
} from '@/server/combine-connections';

export async function combineDuplicateConnections(
  input: CombineConnectionsInput,
): Promise<CombineConnectionsResult> {
  const userId = await requireUserId();
  // This action disconnects a bank and writes reconciliation links; rate-limit it like the
  // other Plaid mutations so a scripted caller can't churn connections.
  if (!(await rateLimitDurable(`combine-connections:${userId}`, 6, 60_000))) {
    return { ok: false, error: 'Too many attempts — wait a minute and try again.' };
  }

  const result = await combineDuplicateConnectionsFor(
    userId,
    input,
    businessToday(userId),
    // The connection row is already gone by the time this runs (the core's claim), so
    // `removeItem` — which looks the row up first — would be a no-op. Revoke the captured token
    // directly; a failure is reported, never swallowed.
    (uid, _itemId, accessToken) => new PlaidProvider().revokeAccessToken(uid, accessToken),
  );

  if (result.ok) {
    // The disconnect half is NOT reversible from here, and the link half rewrote how money is
    // counted — both belong in the trail. The ids are safe to log verbatim BECAUSE the core only
    // proceeds when they match a direction it re-derived itself: an unmatched id never reaches
    // here. `failures` names the pairs that did not link, so a partial run is diagnosable.
    await auditLog(userId, 'accounts.connections.combine', {
      keepItemId: input.keepItemId,
      dropItemId: input.dropItemId,
      combined: result.combined,
      failed: result.failures.length,
      failures: result.failures,
    });
    // The bank is gone from this app either way; if Plaid never confirmed the revoke, the token
    // may still be live upstream, which is a fact about the user's data leaving the app.
    // The token revocation belongs in the trail under its usual action name, whichever path
    // performed it (critic P2-8) — otherwise the audit log shows a bank vanishing with no record
    // that its access was revoked.
    await auditLog(userId, 'plaid.item.remove', {
      itemId: input.dropItemId,
      via: 'combine',
      revoked: result.revokeFailed === null,
    });
    if (result.revokeFailed !== null) {
      await auditLog(userId, 'plaid.item.remove.failed', {
        itemId: input.dropItemId,
        error: result.revokeFailed,
      });
    }
    revalidatePath('/accounts');
    revalidatePath('/dashboard');
    revalidatePath('/cards');
    revalidatePath('/transactions');
  }
  return result;
}
