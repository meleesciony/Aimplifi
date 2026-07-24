/**
 * Preserving a bank connection's identity on the rows it leaves behind (TASKS L.10).
 *
 * Disconnecting a Plaid connection DELETES the `PlaidItem` row and KEEPS the `Account` rows and
 * their history — deliberately, since #253. But the institution lives on the item, so the moment
 * it is deleted every row it fed becomes bank-less, and the identity ladder
 * (`engine/account/identity.ts`) scopes every comparison to one institution: a bank-less row can
 * never be proven the same account as anything.
 *
 * That is precisely backwards, because the disconnected row is the population the combine flow
 * exists for — the app's own advice for a duplicate is "disconnect one side, then combine".
 *
 * So the identity is stamped onto the rows just before the item disappears. Its own function
 * rather than an inline block so every disconnect path — and the tests that stand in for one —
 * shares the single implementation (docs/lessons/fence-by-construction-not-per-call-site.md).
 *
 * Preserve-on-null, the same rule the sync path uses: a connection that never resolved an
 * `ins_*` id must not erase a name that is already stored, and vice versa.
 */
import { prisma } from '@/lib/db';

export interface ConnectionIdentity {
  itemId: string;
  /** The human bank name ("Chase"), best-effort. */
  institution: string | null;
  /** Plaid's stable `ins_*` id. */
  institutionId: string | null;
}

/**
 * The per-ACCOUNT identity Plaid returns on `/accounts/get`, stamped onto the stored rows. Shared
 * by `removeItem` and the combine flow: both are about to revoke a token, and this response is
 * the last time those fields are reachable for a row nothing will sync again (#301). Extracted so
 * a second disconnect path cannot quietly skip it (critic P2-7).
 */
export async function stampAccountIdentity(
  userId: string,
  accounts: readonly { account_id: string; subtype?: string | null; persistent_account_id?: string | null }[],
): Promise<void> {
  for (const a of accounts) {
    const subtype = a.subtype?.trim() || null;
    const persistentAccountId = a.persistent_account_id?.trim() || null;
    if (!subtype && !persistentAccountId) continue;
    await prisma.account
      .updateMany({
        where: { userId, provider: 'plaid', providerRef: a.account_id },
        data: {
          ...(subtype ? { subtype } : {}),
          ...(persistentAccountId ? { persistentAccountId } : {}),
        },
      })
      .catch(() => {});
  }
}

export async function stampConnectionIdentity(userId: string, item: ConnectionIdentity): Promise<void> {
  if (!item.institutionId && !item.institution) return;
  await prisma.account
    .updateMany({
      where: { userId, provider: 'plaid', plaidItemId: item.itemId },
      data: {
        ...(item.institutionId ? { institutionId: item.institutionId } : {}),
        ...(item.institution ? { institutionName: item.institution } : {}),
      },
    })
    // Never a blocker for revoking a token: a failed stamp costs a later combine offer, a
    // failed revocation leaves a live connection the user asked to remove.
    .catch(() => {});
}
