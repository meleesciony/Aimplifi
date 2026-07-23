'use server';

/**
 * Plaid Link server actions (DECISIONS #41) — the front door to the already-
 * validated PlaidProvider ingest (sandbox-proven, ROADMAP #1a). Used directly
 * (not via the DataProvider seam) so linking works regardless of DATA_PROVIDER.
 * Both degrade gracefully when Plaid isn't configured (no keys → {ok:false}),
 * preserving the zero-credential demo.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { DEMO_CONNECT_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { PlaidProvider } from '@/lib/providers/plaid';
import { requireUserId } from '@/server/authz';

export interface LinkTokenResult {
  ok: boolean;
  linkToken?: string;
  /**
   * True when PLAID_ENV is Plaid's sandbox (#256): the hosted Link UI then only
   * accepts Plaid's documented TEST credentials — a real bank login or a real
   * phone number is rejected by Plaid itself, which reads as a broken app unless
   * the UI says so up front.
   */
  sandbox?: boolean;
  error?: string;
}

export interface LinkResult {
  ok: boolean;
  added?: number;
  error?: string;
}

function plaidConfigured(): boolean {
  return Boolean(
    process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET && process.env.DATA_ENCRYPTION_KEY,
  );
}

/** Step 1: mint a Plaid Link token for the client SDK. */
export async function createPlaidLinkToken(): Promise<LinkTokenResult> {
  // requireUserId inside the try so an expired session resolves to {ok:false}
  // (the documented contract) instead of rejecting the server action.
  try {
    const userId = await requireUserId();
    if (isDemoUser(userId)) return { ok: false, error: DEMO_CONNECT_BLOCKED };
    if (!plaidConfigured()) {
      return { ok: false, error: 'Bank linking isn’t configured yet (Plaid keys not set).' };
    }
    const linkToken = await new PlaidProvider().createLinkToken(userId);
    return { ok: true, linkToken, sandbox: (process.env.PLAID_ENV ?? 'sandbox') !== 'production' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not start bank linking.' };
  }
}

/**
 * Step 2: exchange the public token from Plaid Link, then pull accounts,
 * transactions, and liabilities. Reuses the sandbox-validated provider methods.
 */
export async function linkPlaidAccount(publicToken: string): Promise<LinkResult> {
  try {
    const userId = await requireUserId();
    if (isDemoUser(userId)) return { ok: false, error: DEMO_CONNECT_BLOCKED };
    if (!plaidConfigured()) return { ok: false, error: 'Bank linking isn’t configured yet.' };
    if (!publicToken) return { ok: false, error: 'Missing public token.' };
    const provider = new PlaidProvider();
    // The EXCHANGE is the only step that gates link success: once it resolves, the
    // item is persisted (encrypted) and its accounts are synced. The follow-on
    // transaction + liability pulls are BEST-EFFORT — a depository-only institution
    // returns no liabilities (PRODUCTS_NOT_SUPPORTED, expected now that liabilities
    // is required_if_supported, not required), and the sandbox often lags on
    // transactions. Neither must turn a real, successful link into an error, nor
    // skip the cache revalidation that surfaces the just-linked accounts.
    await provider.exchangePublicToken(userId, publicToken);
    let added = 0;
    try {
      added = (await provider.syncTransactions(userId)).added;
    } catch {
      // provider already audits per-item sync failures; a later sweep/webhook backfills
    }
    try {
      await provider.syncLiabilities(userId);
    } catch {
      // no Liabilities product (depository-only) or not yet generated — non-fatal
    }
    revalidatePath('/accounts');
    revalidatePath('/transactions');
    revalidatePath('/dashboard');
    return { ok: true, added };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not link your accounts.' };
  }
}

export interface DisconnectItemResult {
  ok: boolean;
  message?: string;
  error?: string;
}

export interface PlaidSyncNowResult {
  ok: boolean;
  /** Transactions ingested this run. */
  added?: number;
  /** Card statements written — the due dates the cash-needed answer is built on. */
  statementsWritten?: number;
  /** True when every Plaid item errored on /liabilities/get (see LiabilitySyncResult). */
  liabilitiesFailed?: boolean;
  error?: string;
}

/**
 * Sync every linked Plaid bank NOW, on demand (owner-reported 2026-07-23: "some of
 * my accounts haven't been synced for almost a week", and there was no way to make
 * them). SimpleFIN has had `syncSimplefinNow` plus auto-sync-on-load since #91;
 * Plaid had NEITHER — its only ingest was the one-shot pull inside
 * `linkPlaidAccount` and a nightly cron that is a no-op unless DATA_PROVIDER is
 * 'plaid'. So a Plaid account synced once, at link, and then silently went stale
 * with no user-reachable remedy.
 *
 * Runs BOTH halves: transactions and liabilities. They are independent — a failed
 * transaction pull must not cost the user their card due dates, which are the more
 * valuable datum — so each is caught separately and the result says which worked.
 */
export async function syncPlaidNow(itemId?: string): Promise<PlaidSyncNowResult> {
  try {
    const userId = await requireUserId();
    if (isDemoUser(userId)) return { ok: false, error: DEMO_CONNECT_BLOCKED };
    if (!plaidConfigured()) return { ok: false, error: 'Bank linking isn’t configured yet.' };
    // Scoped count doubles as the ownership check for a per-connection sync: a
    // foreign itemId counts 0 and is refused, never silently syncing nothing.
    const items = await prisma.plaidItem.count({
      where: { userId, ...(itemId ? { itemId } : {}) },
    });
    if (items === 0) {
      return { ok: false, error: itemId ? 'That bank isn’t connected.' : 'No Plaid banks are connected.' };
    }

    const provider = new PlaidProvider();
    let added: number | undefined;
    let txError: string | undefined;
    try {
      added = (await provider.syncTransactions(userId, { itemId })).added;
    } catch (e) {
      // The provider already audits per-item sync failures.
      txError = e instanceof Error ? e.message : 'transaction sync failed';
    }

    let statementsWritten: number | undefined;
    let liabilitiesFailed = false;
    try {
      const liab = await provider.syncLiabilities(userId, { itemId });
      statementsWritten = liab.statementsWritten;
      liabilitiesFailed = liab.itemsAttempted > 0 && liab.itemsFailed >= liab.itemsAttempted;
    } catch {
      liabilitiesFailed = true;
    }

    revalidatePath('/accounts');
    revalidatePath('/dashboard');
    revalidatePath('/transactions');
    revalidatePath('/cards');
    revalidatePath('/investments');

    // Only a BOTH-halves failure is a failed sync; either half succeeding is real
    // progress the user should see rather than a red error.
    if (txError !== undefined && liabilitiesFailed) {
      return { ok: false, error: 'Sync failed — please try again in a minute.' };
    }
    return { ok: true, added, statementsWritten, liabilitiesFailed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not sync your banks.' };
  }
}

/**
 * Disconnect one Plaid bank connection (#256): revoke the item's access token at
 * Plaid and delete the local PlaidItem row. Already-synced accounts and their
 * history are KEPT (the SimpleFIN disconnect precedent — the history is the
 * user's); once the item is gone, those accounts become deletable on /accounts
 * (the #253 guard's precondition, previously unreachable for Plaid).
 *
 * The provider's removeItem stamps account→item linkage best-effort BEFORE
 * revoking, revokes at Plaid, deletes the row, and writes its own audit entry.
 * Ownership is enforced by removeItem's user-scoped query: someone else's itemId
 * simply matches nothing.
 */
export async function disconnectPlaidItem(itemId: string): Promise<DisconnectItemResult> {
  try {
    const userId = await requireUserId();
    if (isDemoUser(userId)) return { ok: false, error: DEMO_CONNECT_BLOCKED };
    if (!plaidConfigured()) return { ok: false, error: 'Bank linking isn’t configured yet.' };
    if (!itemId || typeof itemId !== 'string') return { ok: false, error: 'Missing connection id.' };
    const item = await prisma.plaidItem.findFirst({ where: { userId, itemId }, select: { id: true } });
    if (!item) return { ok: false, error: 'Connection not found.' };
    await new PlaidProvider().removeItem(userId, itemId);
    revalidatePath('/accounts');
    revalidatePath('/dashboard');
    return {
      ok: true,
      message:
        'Bank disconnected. Your already-synced accounts and history are kept (they just won’t update). A Delete control appears next to each account no connected bank could bring back — remove any you don’t want counted.',
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not disconnect this bank.' };
  }
}
