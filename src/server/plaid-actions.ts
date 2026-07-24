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
import { auditLog, rateLimitDurable, requireUserId } from '@/server/authz';

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
    try {
      // A just-linked brokerage's positions (TASKS 4.3). No-op (zero billed calls) when the
      // user linked a checking/credit-only bank; non-fatal if the Investments product isn't
      // granted (existing/unsupported institution) — the /investments page just stays as-is.
      await provider.syncHoldings(userId);
    } catch {
      // no Investments product or not yet generated — non-fatal
    }
    revalidatePath('/accounts');
    revalidatePath('/transactions');
    revalidatePath('/dashboard');
    revalidatePath('/investments');
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

export interface WebhookBackfillResult {
  ok: boolean;
  /** How many items needed registering this run (already-registered items are skipped). */
  attempted?: number;
  /** How many were successfully registered at Plaid. */
  updated?: number;
  /** False when PLAID_WEBHOOK_URL is unset — nothing can be registered until it is. */
  configured?: boolean;
  error?: string;
}

/**
 * Register the configured webhook on already-linked Plaid items so background
 * (push) sync starts working. New links carry the webhook automatically via
 * linkTokenParams; this exists for items linked BEFORE PLAID_WEBHOOK_URL was set,
 * which receive no TRANSACTIONS pushes and go stale between manual syncs. The same
 * backfill also runs best-effort at the tail of every syncPlaidNow, so a normal
 * sync backfills too; this is the direct, user-triggerable path.
 */
export async function updatePlaidWebhooksNow(): Promise<WebhookBackfillResult> {
  try {
    const userId = await requireUserId();
    if (isDemoUser(userId)) return { ok: false, error: DEMO_CONNECT_BLOCKED };
    if (!plaidConfigured()) return { ok: false, error: 'Bank linking isn’t configured yet.' };
    if (!process.env.PLAID_WEBHOOK_URL?.trim()) {
      // Distinct from a failure: there is simply nothing to register yet. Surfaced so
      // the caller can tell "not set up" from "tried and failed".
      return {
        ok: false,
        configured: false,
        error: 'Background sync isn’t configured yet (PLAID_WEBHOOK_URL is not set).',
      };
    }
    if (!(await rateLimitDurable(`plaid-webhook-update:${userId}`, 6, 60_000))) {
      return { ok: false, error: 'Too many requests — give it a minute and try again.' };
    }
    const items = await prisma.plaidItem.count({ where: { userId } });
    if (items === 0) return { ok: false, error: 'No Plaid banks are connected.' };

    const r = await new PlaidProvider().updateWebhooks(userId);
    revalidatePath('/accounts');
    return { ok: true, configured: true, attempted: r.attempted, updated: r.updated };
  } catch {
    // Fixed string — a Prisma/validation error can embed server paths + the userId.
    return { ok: false, error: 'Could not update background sync — please try again in a minute.' };
  }
}

export interface PlaidSyncNowResult {
  ok: boolean;
  /** Transactions ingested this run. Undefined ONLY when the half never ran. */
  added?: number;
  /**
   * True when the transaction half FAILED. Critic P1-3: without this, `added:
   * undefined` on a thrown pull is indistinguishable from a genuine zero, and the
   * caller cheerfully reports "No new transactions" to a user whose bank login has
   * expired — the exact silent staleness this feature exists to end.
   */
  transactionsFailed?: boolean;
  /** Card statements written — the due dates the cash-needed answer is built on. */
  statementsWritten?: number;
  /** True when every Plaid item errored on /liabilities/get (see LiabilitySyncResult). */
  liabilitiesFailed?: boolean;
  error?: string;
}

/**
 * Bound the sync path (the repo rule: every request path uses rateLimitDurable).
 * Unlike the SimpleFIN bridge, PRODUCTION PLAID CALLS ARE BILLED PER REQUEST, and
 * the only other brake is a per-tab `sessionStorage` stamp — which a fresh tab, a
 * reload loop, or a bot resets for free (critic P1-4). Generous enough that a real
 * person tapping "Sync now" repeatedly never sees it.
 */
const SYNC_LIMIT = 12;
const SYNC_WINDOW_MS = 60_000;

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
    // A server-action argument is attacker-controlled: TypeScript's `string` is
    // erased at the boundary, so a crafted POST can send any JSON. Unvalidated,
    // `itemId = {not:'x'}` reached the Prisma `where` verbatim, matched EVERY item,
    // passed the ownership gate, and turned "sync this one bank" into "sync all of
    // them" (critic P1-1, executed). Scalar-validate at the boundary, like #271.
    if (itemId !== undefined && (typeof itemId !== 'string' || itemId.trim() === '')) {
      return { ok: false, error: 'That bank isn’t connected.' };
    }
    if (!(await rateLimitDurable(`plaid-sync:${userId}`, SYNC_LIMIT, SYNC_WINDOW_MS))) {
      return { ok: false, error: 'Too many syncs — give it a minute and try again.' };
    }
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
      // The provider audits PER-ITEM sync failures — but a throw that lands HERE is
      // a total one (config, decrypt, the first fetch), and it used to be returned
      // to the UI and lost: nothing in the audit log recorded that a user-initiated
      // sync failed or why (#277 P2). Record it; never let the audit write itself
      // turn the failure report into a second failure.
      txError = e instanceof Error ? e.message : 'transaction sync failed';
      await auditLog(userId, 'plaid.sync.transactions.failed', {
        ...(itemId ? { itemId } : {}),
        error: txError,
      }).catch(() => {});
    }

    let statementsWritten: number | undefined;
    let liabilitiesFailed = false;
    try {
      const liab = await provider.syncLiabilities(userId, { itemId });
      statementsWritten = liab.statementsWritten;
      // Unsupported items (depository-only — the issuer's own "no liability data
      // here") are not failures: a checking-only bank must not paint the Sync
      // button red every tap (#277 P2). Failed = every item that COULD have
      // answered errored, and at least one did.
      liabilitiesFailed =
        liab.itemsFailed > 0 && liab.itemsFailed >= liab.itemsAttempted - liab.itemsUnsupported;
    } catch {
      liabilitiesFailed = true;
    }

    // Best-effort webhook backfill: an item linked BEFORE PLAID_WEBHOOK_URL was set
    // carries no webhook and never receives TRANSACTIONS pushes, so it only refreshes
    // when someone opens the app or the nightly cron runs. Register it now (idempotent
    // — skips items already registered, no-op when the env is unset) so background sync
    // starts working. NEVER fatal: a webhook-registration problem must not turn a
    // successful data pull into a red error.
    try {
      await provider.updateWebhooks(userId, { itemId });
    } catch {
      /* provider isolates + audits per-item failures; a total failure is non-fatal here */
    }

    // Best-effort institution-name backfill (owner-reported 2026-07-23: linked banks
    // read "Connected bank" with no name). Idempotent — only items still missing a name
    // are looked up, so a normal Sync tap labels Chase/Capital One the first time and
    // costs nothing thereafter. Cosmetic: never turns a successful data pull into an error.
    try {
      await provider.syncInstitutions(userId, { itemId });
    } catch {
      /* provider isolates + audits per-item failures; a total failure is non-fatal here */
    }

    // Best-effort investment-holdings refresh (TASKS 4.3). No-op (zero billed calls) for a
    // user with no investment account; isolated + non-fatal like the backfills above — a
    // holdings hiccup must never turn a successful transaction/statement sync into a red
    // error. The /investments revalidation below then surfaces any updated positions.
    try {
      await provider.syncHoldings(userId, { itemId });
    } catch {
      /* provider isolates + audits per-item failures; a total failure is non-fatal here */
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
    return {
      ok: true,
      added,
      transactionsFailed: txError !== undefined,
      statementsWritten,
      liabilitiesFailed,
    };
  } catch {
    // FIXED string. The inner catches were already careful, but this one returned
    // `e.message` — and a Prisma validation error carries the deploy's absolute
    // paths, four lines of server source, the model shape and the raw userId, all
    // of which the UI renders verbatim in a role="alert" (critic P1-2, executed).
    return { ok: false, error: 'Could not sync your banks — please try again in a minute.' };
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
