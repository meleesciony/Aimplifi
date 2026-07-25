/**
 * PlaidProvider — the live (non-demo) data source. DORMANT by default and, per
 * the no-fabrication rule, HONESTLY LABELED:
 *
 *   TESTED (pure, no network): all Plaid→Pulse mapping in plaid-map.ts — sign
 *   flip, account-type mapping, liability→statement, per-row categorization.
 *   See tests/unit/plaid-map.test.ts.
 *
 *   IMPLEMENTED but UNVERIFIED (no sandbox credentials in this build env): the
 *   network orchestration below — /link/token/create, /item/public_token/
 *   exchange, /accounts/get, /transactions/sync (cursor loop), /liabilities/get,
 *   /item/remove. It is real code, not a stub, but has never run against a live
 *   Plaid sandbox. Run docs/PLAID_WALKTHROUGH.md §5 to validate before trusting.
 *
 *   WIRED (DECISIONS #53): recurring re-detection + ScheduledTransaction refresh
 *   after ingest — syncTransactions now calls refreshRecurringForUser (best-effort)
 *   so a sync updates the recurring/subscription series and the cash-needed/FI
 *   projections. The refresh is unit-tested (recurring-refresh.test.ts); the Plaid
 *   sync that triggers it remains UNVERIFIED against a live sandbox.
 *
 * Demo mode is entirely unaffected — the DataProvider seam keeps this dormant.
 */
import type { JWK } from 'jose';
import { dayOfMonthFromISO, type ISODate } from '@/lib/dates';
import { businessToday } from '@/lib/business-today';
import { stampAccountIdentity, stampConnectionIdentity } from '@/lib/providers/plaid-identity';
import { decryptToken, encryptToken } from '@/lib/crypto';
import { isDemoUser } from '@/lib/demo-user';
import { isUniqueViolation, prisma, serializableTx } from '@/lib/db';
import {
  type ExistingConnection,
  type IncomingAccount,
  type LinkCollision,
  detectLinkCollision,
} from '@/lib/engine/account/link-collision';
import { reconcileFeedPresence } from '@/lib/engine/account/feed-presence';
import { refreshTransferFlags } from '@/lib/providers/transfer-refresh';
import { safeSyncErrorReason } from '@/lib/providers/sync-status';
import { loadUserRules } from '@/server/rules';
import { getThresholdTuning } from '@/server/tuning';
import { logCategoryPredictions } from '@/server/predictions';
import { refreshRecurringForUser } from '@/server/recurring';
import {
  type MappedLoanFields,
  type PlaidAccount,
  type PlaidCreditLiability,
  type PlaidMortgageLiability,
  type PlaidStudentLiability,
  type PlaidTransaction,
  mapPlaidAccount,
  mapPlaidLiabilityToStatement,
  mapPlaidMortgageToLoanFields,
  mapPlaidStudentToLoanFields,
  pickPlaidAprBps,
  prepareIngestedTransaction,
} from './plaid-map';
import {
  type MappedPlaidHolding,
  type PlaidHolding,
  type PlaidSecurity,
  mapPlaidHoldings,
} from './plaid-holdings';
import { assistUnsureRows } from '@/server/categorize-assist';
import { categorizeSuggestFor } from '@/server/categorize-suggest';
import { DemoProvider } from './demo';
import type { DataProvider, FinanceSnapshot, SyncResult } from './types';

// The (user, bank) link lease (TASKS L.17b, model PlaidLinkClaim). The wait is deliberately
// short: a link exchange runs inside one serverless request that has already spent seconds on
// Plaid calls, and timing that request out would leave a billed Item whose token was never
// stored — the worst failure on this path (#307). A real double-tap resolves well inside the
// window; anything slower proceeds unprotected, which is exactly today's behaviour and yields a
// duplicate the app discloses (#306) and can combine (#304). The TTL only has to outlast one
// decision, and bounds how long a crashed request can make the next link wait.
const LINK_CLAIM_TTL_MS = 30_000;
const LINK_CLAIM_WAIT_MS = 4_000;
const LINK_CLAIM_POLL_MS = 100;

// Plaid retired the Development environment (2024) — only sandbox/production remain.
const PLAID_HOSTS: Record<string, string> = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
};

function plaidEnv() {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new Error('Plaid credentials missing — set PLAID_CLIENT_ID and PLAID_SECRET');
  }
  // Fail loud on a stale/typo'd env rather than silently hitting a dead host.
  const envName = process.env.PLAID_ENV ?? 'sandbox';
  const host = PLAID_HOSTS[envName];
  if (!host) {
    throw new Error(`PLAID_ENV must be 'sandbox' or 'production' (got "${envName}")`);
  }
  return { clientId, secret, host };
}

/**
 * Format Plaid's error envelope for a thrown Error. error_type/error_code/
 * error_message/request_id are developer-facing and carry NO secret — surfacing
 * them is what makes a failed call diagnosable. (The REQUEST body, which carries
 * the access_token, is never logged.) Pure + unit-tested.
 */
export function plaidErrorSummary(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '(no error body)';
  const e = payload as Record<string, unknown>;
  const code = [e.error_code, e.error_type, e.error_message]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join(' / ');
  const reqId =
    typeof e.request_id === 'string' && e.request_id ? ` (request_id ${e.request_id})` : '';
  return code ? `${code}${reqId}` : '(no error fields)';
}

async function plaidPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { clientId, secret, host } = plaidEnv();
  const response = await fetch(`${host}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, secret, ...body }),
  });
  if (!response.ok) {
    // Surface Plaid's RESPONSE error envelope (safe, no secrets) so the first real
    // run is diagnosable — never the REQUEST body, which carries the access_token.
    let detail = '';
    try {
      detail = ` ${plaidErrorSummary(await response.json())}`;
    } catch {
      detail = '';
    }
    throw new Error(`Plaid ${path} failed: ${response.status}${detail}`);
  }
  return response.json() as Promise<T>;
}

/**
 * Webhook verification key resolver (ROADMAP #1c). Fetches Plaid's published ES256
 * public key for a `kid` via /webhook_verification_key/get and caches non-expired
 * keys (Plaid rotates them). Returns null on any failure so the verifier rejects
 * cleanly. UNVERIFIED against live Plaid (no sandbox creds in this env); the
 * verification LOGIC is unit-tested with a real keypair (plaid-webhook.test.ts).
 */
const webhookKeyCache = new Map<string, JWK>();

export async function fetchPlaidWebhookKey(kid: string): Promise<JWK | null> {
  const cached = webhookKeyCache.get(kid);
  if (cached) return cached;
  try {
    const { key } = await plaidPost<{ key: (JWK & { expired_at?: number | null }) | null }>(
      '/webhook_verification_key/get',
      { key_id: kid },
    );
    if (!key) return null;
    // Reject (don't trust OR cache) a key Plaid has already rotated out — matches
    // Plaid's reference verifier. expired_at is a Unix timestamp (number), nullable.
    if (key.expired_at != null) return null;
    webhookKeyCache.set(kid, key);
    return key;
  } catch {
    return null;
  }
}

/**
 * Build the `/link/token/create` request body (minus client_id/secret, which
 * plaidPost injects). Pure + unit-tested (tests/unit/plaid-oauth.test.ts). Keeping
 * `liabilities` AND `investments` in required_if_supported (not `products`) is what
 * keeps depository-only banks linkable: a bank without an investments/liabilities
 * product still links, and the corresponding sync simply reports the item as
 * `unsupported` (never `failed`, TASKS 4.3 / #277 P2). `investments` grants the
 * /investments/holdings/get product so a linked brokerage's positions can sync
 * (existing items linked BEFORE this need re-linking to gain it). `redirectUri` is
 * registered ONLY when set: an OAuth bank (Chase/BofA) redirects the browser to it to
 * hand the user back; when unset the key is omitted entirely so non-OAuth linking works
 * with zero extra config (Plaid rejects a redirect_uri that isn't an exact match for a
 * dashboard-registered URI).
 */
export function linkTokenParams(
  userId: string,
  redirectUri?: string,
  /**
   * UPDATE MODE (TASKS L.10 layer 1). Supply an existing item's RAW access token to
   * reopen Link on the connection the user already has, instead of creating a second
   * one. This is Plaid's own documented remedy for "I need to add an account" and for
   * repairing a broken login: every already-linked account comes back with its existing
   * `account_id`, so the account upsert takes its UPDATE branch, which is a refresh.
   * Verified at plaid.com/docs/link/update-mode (fetched 2026-07-24).
   *
   * Scope, precisely: THIS door cannot duplicate. The FRONT door still can, and the
   * owner's "I ran Plaid again and hit select-all" goes through the front door — it is
   * layer 2 (collision interception on `exchangePublicToken`) that makes that scenario
   * incapable of duplicating, and layer 2 is not built yet.
   */
  update?: { accessToken: string },
): Record<string, unknown> {
  const base = {
    user: { client_user_id: userId },
    client_name: 'Aimplifi',
    country_codes: ['US'],
    language: 'en',
    webhook: process.env.PLAID_WEBHOOK_URL || undefined,
    // Registered in BOTH modes: an OAuth bank hands the browser back through it, and
    // update mode reaches the same banks the front door does.
    redirect_uri: redirectUri || undefined,
  };
  if (update) {
    return {
      ...base,
      access_token: update.accessToken,
      // Lets the user tick accounts they didn't share the first time. Plaid honours this
      // at non-OAuth institutions and at OAuth ones without their own account picker; at
      // the rest (Chase and friends) the bank runs that step on its own site. Either way
      // the user chooses, and either way nothing here creates a second Item.
      update: { account_selection_enabled: true },
    };
    // `products` and `required_if_supported_products` are DELIBERATELY absent: Plaid
    // documents that no products and no product-specific parameters may be sent when a
    // link token carries an access_token (outside the credit-product exception, which is
    // not this). Structural, not a spread that could quietly grow one back.
  }
  return {
    ...base,
    products: ['transactions'],
    required_if_supported_products: ['liabilities', 'investments'],
  };
}

/**
 * Outcome of one user's liability sweep. Per-item errors are swallowed inside
 * `syncLiabilities` (one bad item must not cost the others their data), so these
 * counts are the ONLY way a caller can tell "nothing to sync" from "every item
 * failed" — which is the difference between a card having no due date because the
 * issuer sends none, and because the sync is broken (critic F-6).
 */
export interface LiabilitySyncResult {
  itemsAttempted: number;
  /** Items that errored for a reason OTHER than "this item has no liability data". */
  itemsFailed: number;
  /**
   * Items Plaid answered with PRODUCTS_NOT_SUPPORTED / NO_LIABILITY_ACCOUNTS — the
   * issuer's own "there is nothing here" for a depository-only item. Expected, not
   * broken; counted apart from `itemsFailed` so a checking-only item doesn't read
   * as a daily sync failure (#277 P2).
   */
  itemsUnsupported: number;
  /** Statements actually written (a card can sync fine and still generate none). */
  statementsWritten: number;
}

export interface WebhookUpdateResult {
  /** Items that needed the webhook registered (already-current items are skipped, not counted). */
  attempted: number;
  /** Items that were successfully updated at Plaid AND recorded locally. */
  updated: number;
  /** Items whose /item/webhook/update call failed (audited, isolated — never blocks the rest). */
  failed: number;
}

export interface InstitutionSyncResult {
  /** Items still missing an institution name and/or its `ins_*` id, which were looked up (a fully-resolved item is skipped, not counted). */
  attempted: number;
  /** Items where a name and/or an institution id was resolved from Plaid AND recorded locally. */
  updated: number;
  /** Items whose lookup failed (audited, isolated — never blocks the rest). NOT exclusive with
   *  `updated`: the id and the name are bought separately, so an item can record one and fail
   *  the other in the same pass. */
  failed: number;
}

/**
 * Outcome of one user's investment-HOLDINGS sweep (TASKS 4.3). Per-item errors are
 * swallowed inside `syncHoldings`, so — exactly like LiabilitySyncResult — these counts
 * are the only way a caller tells "nothing to sync" from "the pull failed". `itemsAttempted`
 * counts only items that HAVE an investment account (a checking/credit-only item is never
 * asked, to avoid a per-request-billed call that could only return PRODUCTS_NOT_SUPPORTED).
 */
export interface HoldingsSyncResult {
  itemsAttempted: number;
  /** Items that errored for a reason OTHER than "no Investments product on this item". */
  itemsFailed: number;
  /** Items Plaid answered with PRODUCTS_NOT_SUPPORTED — expected (item linked before
   *  `investments` was requested, or the institution doesn't support it), never a failure. */
  itemsUnsupported: number;
  /** Positions written or updated (source='plaid'). */
  upserted: number;
  /** Stale synced positions deleted (sold). */
  removed: number;
  /** Feed positions not recorded (un-mappable / out of bounds / a manual-ticker collision). */
  skipped: number;
  /** Positions withheld because their value currency isn't USD (no FX — DECISIONS #156). */
  withheldNonUsd: number;
}

/**
 * What a completed exchange actually DID — the three outcomes the front door can have now that
 * it is allowed to refuse (TASKS L.10 layer 2). Every one of them is a state the user is told
 * about: invariant D9 says no structural change is silent, and "we threw your new connection
 * away" is the most structural change this app makes on its own.
 */
export type LinkOutcome =
  /** The ordinary link: a new connection was created. */
  | { readonly kind: 'linked'; readonly itemId: string }
  /**
   * Nothing was written. Every account this login returned is one the user already has through
   * `existingItemId`, so the new Item was handed back to Plaid and the existing one is refreshed
   * instead — the behaviour the owner asked for by name.
   */
  | {
      readonly kind: 'already-connected';
      readonly existingItemId: string;
      readonly institutionName: string | null;
      readonly matchedAccountCount: number;
    }
  /**
   * Both connections were kept, because this one reaches at least one account the other cannot,
   * but they overlap — the honest middle case (a joint account visible from two logins).
   */
  | {
      readonly kind: 'linked-with-overlap';
      readonly itemId: string;
      readonly existingItemId: string;
      readonly institutionName: string | null;
      readonly matchedAccountCount: number;
      readonly newAccountCount: number;
    };

export class PlaidProvider implements DataProvider {
  today(userId?: string): ISODate {
    // Real Plaid users get the real clock; DEMO_TODAY still pins it for tests
    // (DECISIONS #58). Single source of truth with the demo provider.
    return businessToday(userId);
  }

  /** Step 1 of Link: create a link token for the client-side Plaid Link SDK. */
  async createLinkToken(userId: string): Promise<string> {
    // Params (incl. the opt-in OAuth redirect_uri) live in the pure, unit-tested
    // linkTokenParams; this method just injects the configured redirect URI.
    const result = await plaidPost<{ link_token: string }>(
      '/link/token/create',
      linkTokenParams(userId, process.env.PLAID_REDIRECT_URI || undefined),
    );
    return result.link_token;
  }

  /**
   * Link in UPDATE MODE on a connection the user already has (TASKS L.10 layer 1) —
   * the path for "add an account I didn't share" and for repairing a login, neither of
   * which should ever produce a second copy of a bank. Ownership is enforced by
   * `accessTokenFor`, which resolves the token only from a row matching BOTH the item id
   * and this user, and throws otherwise: a foreign itemId can never mint a token here.
   */
  async createUpdateLinkToken(userId: string, itemId: string): Promise<string> {
    const accessToken = await this.accessTokenFor(userId, itemId);
    const result = await plaidPost<{ link_token: string }>(
      '/link/token/create',
      linkTokenParams(userId, process.env.PLAID_REDIRECT_URI || undefined, { accessToken }),
    );
    return result.link_token;
  }

  /** Step 2: exchange the public token; store it ENCRYPTED, then pull accounts. */
  async exchangePublicToken(userId: string, publicToken: string): Promise<LinkOutcome> {
    const result = await plaidPost<{ access_token: string; item_id: string }>(
      '/item/public_token/exchange',
      { public_token: publicToken },
    );
    // Resolve the human institution name ("Chase") so the /accounts connection row can
    // LABEL this bank instead of the generic "Connected bank" — the schema field and the
    // UI have always supported it; nothing ever wrote it (owner-reported 2026-07-23, two
    // linked banks both reading "Plaid: Connected bank"). The same call now also yields the
    // stable `ins_*` id, which is identity rather than decoration (see resolveInstitution).
    // Best-effort for BOTH: a lookup failure must NEVER fail a real link — syncInstitutions
    // backfills them on the next sweep/Sync. Null → omitted below (preserve-on-null #130).
    let institution: string | null = null;
    let institutionId: string | null = null;
    try {
      const resolved = await this.resolveInstitution(result.access_token);
      institution = resolved.name;
      institutionId = resolved.institutionId;
    } catch {
      /* cosmetic + backfillable; syncInstitutions retries — never blocks the link */
    }
    // ---- Layer 2b: one decision at a time per (user, bank) (TASKS L.17b) ------------------
    // The decision below READS the user's connections at this bank and then WRITES one. Two
    // Link sessions racing through that gap — two tabs, a double-tap — both saw zero
    // connections and both persisted, so invariant D1 held by sequence rather than by
    // construction. The lease makes the DECISION exclusive; the outcome deliberately is not
    // (two connections at one bank are legitimate — a spouse's own login).
    //
    // A link whose institution never resolved takes no lease: the collision check abstains on
    // it anyway, so there is nothing to be exclusive about. Failing to get the lease is not a
    // reason to fail a real link either — see acquireLinkClaim.
    const claim = institutionId ? await this.acquireLinkClaim(userId, institutionId) : null;
    try {
      return await this.decideAndPersistItem(
        userId,
        result.access_token,
        result.item_id,
        institutionId,
        institution,
      );
    } finally {
      if (claim) await this.releaseLinkClaim(claim);
    }
  }

  /**
   * Decide what a just-exchanged item is and persist the outcome — the body of a link, run
   * under the (user, bank) lease its caller holds.
   *
   * ---- Layer 2: collision interception (TASKS L.10, design §4) ----
   * The owner's complaint, verbatim: *"Why in the heck are you allowed to make 2 of the same
   * accounts… when I try to link same account again, it just refreshes."* Everything before
   * this told the copies apart after the fact. This is the door.
   *
   * The decision runs BEFORE the PlaidItem upsert, not after it as the checkpoint sketched —
   * because the upsert is by `itemId` and may UPDATE a row that already existed. Deciding
   * first means the redundant path writes nothing at all, so there is no row to roll back and
   * no way to delete a connection this link did not create. Invariant D6 (no Account row
   * before the decision) is satisfied a fortiori: no PlaidItem row either.
   */
  private async decideAndPersistItem(
    userId: string,
    accessToken: string,
    itemId: string,
    institutionId: string | null,
    institution: string | null,
  ): Promise<LinkOutcome> {
    const decision = await this.classifyNewItem(
      userId,
      accessToken,
      itemId,
      institutionId,
      institution,
    );
    if (decision && decision.collision.kind === 'already-connected' && decision.whollyRedundant) {
      // Every account this login returned is one the user ALREADY has through another live
      // connection, so keeping it adds no account, no balance and no transaction source — it
      // only bills a second Item and paints every account twice. Discard it at Plaid and
      // refresh what they already had, which is what "it just refreshes" means.
      //
      // Why no "keep both?" prompt before an irreversible act (invariant D7): the escape is
      // STRUCTURAL rather than a question. We refuse only when the new connection is wholly
      // redundant, so a genuinely different login — the spouse's, which carries at least one
      // account of her own — never reaches this branch and is kept automatically below. The
      // same property re-opens the door by itself: the moment that login exposes anything new,
      // it stops being redundant and links normally.
      const discarded = await this.discardRedundantItem(
        userId,
        accessToken,
        itemId,
        decision.collision,
      );
      if (discarded) {
        return {
          kind: 'already-connected',
          existingItemId: decision.collision.itemId,
          institutionName: decision.collision.institutionName ?? institution,
          matchedAccountCount: decision.collision.matches.length,
        };
      }
      // Revoke failed — fall through and keep it, so the user owns a connection they can see.
    }
    // Upsert by itemId so a link that failed AFTER the token was stored (e.g. the
    // initial account sync threw) stays retryable — re-linking refreshes the token
    // instead of hitting the itemId unique constraint and locking the user out.
    await prisma.plaidItem.upsert({
      where: { itemId },
      create: {
        userId,
        itemId,
        accessToken: encryptToken(accessToken),
        // Only set when resolved: never overwrite a real name or id with null on a re-link.
        ...(institution ? { institution } : {}),
        ...(institutionId ? { institutionId } : {}),
      },
      update: {
        accessToken: encryptToken(accessToken),
        ...(institution ? { institution } : {}),
        ...(institutionId ? { institutionId } : {}),
      },
    });
    await prisma.auditLog.create({
      data: { userId, action: 'plaid.item.link', meta: JSON.stringify({ itemId }) },
    });
    // Accounts must exist before transactions can be mapped to them. Reuse the /accounts/get
    // the collision check already paid for — Plaid bills per request, and re-fetching here
    // would double the cost of every ordinary link. Falls back to the fetch when the check
    // could not run (no institution id, or the call failed).
    if (decision) await this.upsertPlaidAccounts(userId, decision.accounts, itemId);
    else await this.syncAccountsForItem(userId, itemId);

    if (decision && decision.collision.kind === 'already-connected') {
      // A PARTIAL overlap: some accounts are provably ones they already have, at least one is
      // not. Both connections are kept — dropping this one would strand the accounts only it
      // can reach — but the overlap is said out loud at the moment it is created, rather than
      // leaving the user to find the same card listed twice and wonder (#299/#306).
      return {
        kind: 'linked-with-overlap',
        itemId,
        existingItemId: decision.collision.itemId,
        institutionName: decision.collision.institutionName ?? institution,
        matchedAccountCount: decision.incoming.length - decision.newRefs.length,
        newAccountCount: decision.newRefs.length,
      };
    }
    return { kind: 'linked', itemId };
  }

  /**
   * Decide what a just-exchanged item actually IS, before anything is written.
   *
   * Returns `null` when no decision could be made — no `ins_*` id resolved for this link (the
   * identity ladder refuses to compare institutions by name, and rightly: distinct banks share
   * names like "First National"), or the accounts fetch failed. Null means LINK NORMALLY. That
   * is the deliberate failure direction: a missed collision leaves a duplicate the app already
   * discloses (#306) and can combine (#304), while a wrong one would throw away a real
   * connection. Never let this check fail a real link.
   */
  private async classifyNewItem(
    userId: string,
    accessToken: string,
    newItemId: string,
    institutionId: string | null,
    institutionName: string | null,
  ): Promise<{
    readonly collision: LinkCollision;
    /** Every account this link returned, so the caller can upsert without re-fetching. */
    readonly accounts: readonly PlaidAccount[];
    /** The subset this app can actually represent — an unmappable account is none of these. */
    readonly incoming: readonly IncomingAccount[];
    /** Accounts no existing connection at this bank can reach. What "new" honestly means. */
    readonly newRefs: readonly string[];
    /** True only when NOTHING in this link is new — the sole case that licenses a discard. */
    readonly whollyRedundant: boolean;
  } | null> {
    if (!institutionId) return null;
    let accounts: readonly PlaidAccount[];
    try {
      accounts = (
        await plaidPost<{ accounts: PlaidAccount[] }>('/accounts/get', { access_token: accessToken })
      ).accounts;
    } catch {
      return null;
    }
    try {
      // An account whose `type` this app cannot map (Plaid's documented `other`) never becomes
      // a row: it has no balance, no transactions and no surface anywhere. So it is excluded
      // from BOTH counts rather than treated as something a connection "reaches" — counting it
      // as new would keep a whole second Item, and duplicate every account that IS visible, to
      // preserve access to something the user cannot see. If the mapper ever learns that type,
      // the same account becomes genuinely new and the link stops being redundant by itself.
      const incoming: IncomingAccount[] = [];
      for (const a of accounts) {
        let mapped;
        try {
          mapped = mapPlaidAccount(a);
        } catch {
          continue;
        }
        incoming.push({
          ref: a.account_id,
          identity: {
            provider: 'plaid',
            institutionId,
            institutionName,
            mask: mapped.mask,
            type: mapped.type,
            subtype: mapped.subtype,
            currency: mapped.currency,
            persistentAccountId: mapped.persistentAccountId,
            connectionId: newItemId,
          },
        });
      }
      // The user's OTHER connections at THIS bank. A connection that cannot NAME its bank is
      // asked which one it is, because `institutionId` is null on every item linked before that
      // column shipped — including every one the owner had when this door was built (TASKS
      // L.17a). Selecting on the column alone made the whole check a no-op at exactly those
      // banks, silently, until an ordinary sync happened to backfill them.
      const items = await this.candidatesAtInstitution(userId, institutionId, newItemId);
      if (items.length === 0) {
        return { collision: { kind: 'none' }, accounts, incoming, newRefs: [], whollyRedundant: false };
      }
      // Ask each candidate what it can ACTUALLY reach, right now, rather than trusting the
      // Account rows it left behind. Both fresh-context critics broke the DB-snapshot version
      // the same way, and the two P0s share this one cause: an irreversible `/item/remove` was
      // being authorised by state that no longer described the connection being kept.
      //   * A connection whose login has EXPIRED still has all its rows, so re-linking to fix
      //     it — the commonest reason anyone re-runs Link — discarded the credential that had
      //     just fixed it and kept the dead one, while claiming it had refreshed.
      //   * A row the feed stopped returning (deselected in update mode, or closed at the bank
      //     — TASKS L.14) still matched, so the only live route to that account was revoked.
      //   * A row predating the `plaidItemId` stamp (#256) was invisible, so the app created
      //     the very duplicate it exists to prevent.
      // A candidate that cannot answer is not a candidate: it proves nothing, so it takes part
      // in no match, and the new connection is kept.
      const existing: ExistingConnection[] = [];
      for (const item of items) {
        let live: readonly PlaidAccount[];
        try {
          const token = await this.accessTokenFor(userId, item.itemId);
          live = (await plaidPost<{ accounts: PlaidAccount[] }>('/accounts/get', {
            access_token: token,
          })).accounts;
        } catch {
          continue;
        }
        const identities = [];
        for (const a of live) {
          let mapped;
          try {
            mapped = mapPlaidAccount(a);
          } catch {
            continue;
          }
          identities.push({
            provider: 'plaid',
            institutionId: item.institutionId,
            institutionName: item.institution,
            mask: mapped.mask,
            type: mapped.type,
            subtype: mapped.subtype,
            currency: mapped.currency,
            persistentAccountId: mapped.persistentAccountId,
            connectionId: item.itemId,
          });
        }
        existing.push({
          itemId: item.itemId,
          institutionName: item.institution,
          accounts: identities,
        });
      }
      const collision = detectLinkCollision(incoming, existing);
      // What this link reaches that NOTHING the user already has does — computed against every
      // candidate, not just the one named in the collision. With three connections at one bank
      // the winner's "unmatched" set includes accounts a SIBLING connection already carries, so
      // using it would tell the user this login reaches something new while a third copy is
      // what gets created.
      const newRefs = incoming
        .filter((inc) => detectLinkCollision([inc], existing).kind === 'none')
        .map((inc) => inc.ref);
      return {
        collision,
        accounts,
        incoming,
        newRefs,
        whollyRedundant: collision.kind === 'already-connected' && newRefs.length === 0,
      };
    } catch {
      // A DB failure here must not cost the user their link either.
      return { collision: { kind: 'none' }, accounts, incoming: [], newRefs: [], whollyRedundant: false };
    }
  }

  /**
   * Take the (user, bank) lease that makes one link decision run at a time (TASKS L.17b).
   *
   * Returns the claim's id, or `null` when the lease could not be had inside
   * `LINK_CLAIM_WAIT_MS`. Null means PROCEED UNPROTECTED, and that is deliberate: this is a
   * user standing in front of a bank they just authenticated with, and the worst outcome of
   * proceeding is a duplicate the app discloses (#306) and can combine (#304), while the worst
   * outcome of refusing is a completed Link session thrown away with a billed Item behind it.
   * The waiting is what does the work — the loser of a real race sees the winner's connection
   * the moment it is released, and treats its own link as the refresh it is.
   *
   * A claim past its `expiresAt` is taken over rather than waited on: the request that made it
   * is gone (a crash, a serverless timeout), and a lease nobody will ever release would wall
   * off the bank instead of protecting it.
   */
  private async acquireLinkClaim(userId: string, institutionId: string): Promise<string | null> {
    const deadline = Date.now() + LINK_CLAIM_WAIT_MS;
    for (;;) {
      try {
        const claim = await prisma.plaidLinkClaim.create({
          data: { userId, institutionId, expiresAt: new Date(Date.now() + LINK_CLAIM_TTL_MS) },
        });
        return claim.id;
      } catch (e) {
        if (!isUniqueViolation(e)) return null; // never let bookkeeping cost a real link
      }
      // Someone else holds it. Take it over only if it has expired — deleting by the id we
      // just read, so a concurrent takeover of the same dead claim loses the create instead
      // of deleting the live claim its rival went on to make.
      const held = await prisma.plaidLinkClaim.findUnique({
        where: { userId_institutionId: { userId, institutionId } },
      });
      if (held && held.expiresAt.getTime() <= Date.now()) {
        await prisma.plaidLinkClaim.deleteMany({ where: { id: held.id } });
      } else if (Date.now() >= deadline) {
        return null;
      } else {
        await new Promise((resolve) => setTimeout(resolve, LINK_CLAIM_POLL_MS));
      }
    }
  }

  /** Release the lease. Failing to release is harmless — `expiresAt` frees it regardless. */
  private async releaseLinkClaim(claimId: string): Promise<void> {
    try {
      await prisma.plaidLinkClaim.deleteMany({ where: { id: claimId } });
    } catch {
      /* the lease expires on its own; a stuck delete must not fail a completed link */
    }
  }

  /**
   * The user's other connections at one bank — the population the identity ladder compares a
   * new link against.
   *
   * A connection whose `institutionId` is null is not evidence that it belongs elsewhere; it is
   * an item linked before that column existed, which says nothing at all. So it is asked
   * (`/item/get`) which bank it is, and the answer is written back exactly as the
   * `syncInstitutions` sweep would have — the id is bought at most once per connection, and only
   * ever while a link at another bank is in flight, which is the one moment it is worth buying.
   *
   * A connection that cannot answer is not a candidate: it proves nothing about being the same
   * bank, so it takes no part in a match and the new link is kept. Same failure direction as the
   * rest of this path — a duplicate the app discloses (#306) and can combine (#304), never a
   * discarded connection.
   */
  private async candidatesAtInstitution(
    userId: string,
    institutionId: string,
    newItemId: string,
  ): Promise<readonly { itemId: string; institution: string | null; institutionId: string }[]> {
    const siblings = await prisma.plaidItem.findMany({
      where: {
        userId,
        itemId: { not: newItemId },
        OR: [{ institutionId }, { institutionId: null }],
      },
    });
    const candidates: { itemId: string; institution: string | null; institutionId: string }[] = [];
    for (const item of siblings) {
      if (item.institutionId) {
        candidates.push({
          itemId: item.itemId,
          institution: item.institution,
          institutionId: item.institutionId,
        });
        continue;
      }
      let resolved: string | null = null;
      try {
        // The row came from a user-scoped query, so it is this user's to decrypt (the
        // syncInstitutions idiom). Persisted whichever bank it turns out to be: the call is
        // paid for either way, and a candidate at a DIFFERENT bank is the case that would
        // otherwise re-buy the same id on every future link.
        resolved = await this.resolveInstitutionId(decryptToken(item.accessToken));
        if (resolved) {
          await prisma.plaidItem.update({
            where: { itemId: item.itemId },
            data: { institutionId: resolved },
          });
        }
      } catch (e) {
        try {
          await prisma.auditLog.create({
            data: {
              userId,
              action: 'plaid.institution.resolve.failed',
              meta: JSON.stringify({
                itemId: item.itemId,
                context: 'link-collision-candidate',
                error: e instanceof Error ? e.message : 'unknown error',
              }),
            },
          });
        } catch {
          /* audit is diagnostic only */
        }
      }
      if (resolved === institutionId) {
        candidates.push({ itemId: item.itemId, institution: item.institution, institutionId });
      }
    }
    return candidates;
  }

  /**
   * Hand back an Item the app decided not to keep. No row was ever written for it, so unlike
   * `removeItem` there is nothing to delete and nothing to stamp (the identity capture that
   * matters here belongs to the connection the user is KEEPING, which is untouched). The audit
   * row is the record that this happened at all — without it a discarded link is invisible.
   */
  private async discardRedundantItem(
    userId: string,
    accessToken: string,
    itemId: string,
    collision: Extract<LinkCollision, { kind: 'already-connected' }>,
  ): Promise<boolean> {
    try {
      await plaidPost('/item/remove', { access_token: accessToken });
    } catch {
      // The revoke failed, so the Item is still LIVE at Plaid. Returning false makes the caller
      // fall through and persist it as an ordinary connection. That is deliberately the lesser
      // evil: keeping it produces a duplicate the user can see, disclose and combine, whereas
      // walking away would leave a billed Item whose access token the app has forgotten —
      // unremovable, invisible, and minted afresh on every retry.
      return false;
    }
    // Best-effort, and AFTER the revoke that it describes. The connection is already gone by
    // this point, so a failed audit write must not surface to the user as "linking failed" and
    // send them round a loop that burns a new Item each time.
    await prisma.auditLog
      .create({
        data: {
          userId,
          action: 'plaid.item.link.redundant',
          meta: JSON.stringify({
            discardedItemId: itemId,
            keptItemId: collision.itemId,
            matches: collision.matches.map((m) => m.reasons.join('; ')),
          }),
        },
      })
      .catch(() => {});
    return true;
  }

  /** /accounts/get → upsert Account rows (type-mapped; current balance signed). */
  async syncAccountsForItem(userId: string, itemId: string): Promise<void> {
    const token = await this.accessTokenFor(userId, itemId);
    const { accounts } = await plaidPost<{ accounts?: unknown }>('/accounts/get', {
      access_token: token,
    });
    // A well-formed 200 always carries an account ARRAY. A missing / null / non-array one (a
    // truncated or garbled-but-200 body, proxy corruption, schema drift) used to reach the upsert
    // loop and throw `accounts is not iterable` — swallowed into an audit line on the sync path,
    // but thrown straight out of the LINK path, where it fails an otherwise good connection. Same
    // hazard the holdings sweep already guards with Array.isArray (the #128 `transactions: null`
    // class); found by this slice's own presence test, which could not otherwise be reached.
    if (Array.isArray(accounts)) {
      await this.upsertPlaidAccounts(userId, accounts as PlaidAccount[], itemId);
    } else {
      await prisma.auditLog
        .create({
          data: { userId, action: 'plaid.accounts.malformed', meta: JSON.stringify({ itemId }) },
        })
        .catch(() => {});
    }
    // ONLY here. /accounts/get is the item's complete census; `/transactions/sync` echoes just
    // the accounts with transaction activity (see the comment on that call), so reading absence
    // from it would mark every quiet loan, card and brokerage as unshared.
    await this.stampFeedPresence(userId, itemId, accounts);
  }

  /**
   * Stamp the rows this connection has STOPPED returning, and un-stamp the ones it returns
   * again (TASKS L.14). Plaid Link update mode ships with `account_selection_enabled`, so a user
   * can untick an account; until now nothing noticed, and the row kept its last balance, kept
   * counting, and kept reading as freshly synced because its BANK was still syncing (#293).
   *
   * Adjusts no figure and deletes nothing — see the schema comment on `Account.feedDroppedAt`
   * for why that is deliberate. Best-effort and audited: a presence bookkeeping failure must
   * never fail a sync that already wrote real balances.
   */
  private async stampFeedPresence(
    userId: string,
    itemId: string,
    accounts: unknown,
  ): Promise<void> {
    try {
      // Scoped to rows we can PROVE belong to this connection. A row whose plaidItemId is still
      // null (linked before #256 and not re-synced since) is not evidence of anything: it might
      // belong to another item or to a disconnected one, and guessing would drop it wrongly. The
      // failure direction is a miss, and it self-heals — every ordinary sync stamps the linkage.
      const rows = await prisma.account.findMany({
        where: { userId, provider: 'plaid', plaidItemId: itemId },
        select: { id: true, providerRef: true, feedDroppedAt: true },
      });
      if (rows.length === 0) return;
      const refs: unknown = Array.isArray(accounts)
        ? accounts.map((a: { account_id?: unknown }) => a?.account_id)
        : accounts;
      const decision = reconcileFeedPresence(rows, refs, this.today(userId));
      if (decision.kind === 'skip') {
        // A payload we could not trust. Recorded rather than silently ignored, because a feed
        // stuck in this state means the protection is not running at that bank.
        await prisma.auditLog
          .create({
            data: {
              userId,
              action: 'plaid.accounts.presence.skipped',
              meta: JSON.stringify({ itemId, reason: decision.reason }),
            },
          })
          .catch(() => {});
        return;
      }
      if (decision.drop.length === 0 && decision.restore.length === 0) return;
      // serializableTx, not a raw $transaction — the repo-wide lock every write path in this file
      // obeys. Both updates land together so a reader can never see a census half-applied (one
      // account announced as unshared while its sibling's restore is still pending). Both are
      // userId-scoped as well as id-scoped: the ids came from a query, but a write that can freeze
      // an account gets the ownership predicate stated at the write itself.
      await serializableTx(async (tx) => {
        if (decision.drop.length > 0) {
          await tx.account.updateMany({
            where: { id: { in: [...decision.drop] }, userId },
            data: { feedDroppedAt: decision.droppedAt },
          });
        }
        if (decision.restore.length > 0) {
          await tx.account.updateMany({
            where: { id: { in: [...decision.restore] }, userId },
            data: { feedDroppedAt: null },
          });
        }
      });
      await prisma.auditLog
        .create({
          data: {
            userId,
            action: 'plaid.accounts.presence',
            meta: JSON.stringify({
              itemId,
              dropped: decision.drop.length,
              restored: decision.restore.length,
            }),
          },
        })
        .catch(() => {});
    } catch (e) {
      await prisma.auditLog
        .create({
          data: {
            userId,
            action: 'plaid.accounts.presence.failed',
            meta: JSON.stringify({ itemId, error: e instanceof Error ? e.message : String(e) }),
          },
        })
        .catch(() => {});
    }
  }

  /**
   * Upsert Plaid accounts (from /accounts/get OR the /transactions/sync `accounts`
   * array). Per-account guarded: an account Plaid returns with a type we can't map
   * (e.g. the documented `other`) is skipped + audited rather than aborting the
   * whole item link/sync — a single odd account must never block every other one.
   */
  private async upsertPlaidAccounts(
    userId: string,
    accounts: readonly PlaidAccount[],
    /** The owning Plaid item — stamped so the delete guard can tell whose sync would resurrect a row (#256). */
    itemId: string,
  ): Promise<void> {
    for (const a of accounts) {
      let m: ReturnType<typeof mapPlaidAccount>;
      try {
        m = mapPlaidAccount(a);
      } catch (e) {
        await prisma.auditLog
          .create({
            data: {
              userId,
              action: 'plaid.account.skipped',
              meta: JSON.stringify({
                accountId: a.account_id,
                type: a.type,
                reason: e instanceof Error ? e.message : String(e),
              }),
            },
          })
          .catch(() => {});
        continue;
      }
      // currentBalanceCents is OMITTED from the shared base on purpose: a null `current`
      // (balance unknown this fetch) must PRESERVE the stored value on update, never overwrite
      // a real balance with $0 — a silent net-worth crater now that investment/loan balances
      // refresh every sync (DECISIONS #130). It is added back conditionally below.
      const base = {
        name: m.name,
        type: m.type,
        mask: m.mask,
        // Always written (null = assumed USD); unlike currentBalanceCents there is no
        // preserve-on-null need — a currency is not a balance (DECISIONS #135).
        currency: m.currency,
        availableBalanceCents: m.availableBalanceCents,
        creditLimitCents: m.creditLimitCents,
        // Written on update too, so rows created before #256 back-fill their item
        // linkage on the first sync after deploy.
        plaidItemId: itemId,
        // Identity columns (docs/ACCOUNT_IDENTITY_ARCHITECTURE.md §6). Written on update
        // too, so an account linked before they existed backfills on its next ordinary
        // sync — no re-link, no data migration.
        //
        // The two follow DIFFERENT rules, and the difference is load-bearing:
        //
        // `subtype` is written ALWAYS, like `currency`, because `type` above is DERIVED
        // from it (mapPlaidAccountType) and `type` is itself written unconditionally.
        // Preserving one while recomputing the other lets a row settle at
        // `type: LOAN, subtype: 'mortgage'` — two stored facts contradicting each other,
        // on exactly the pair the identity ladder compares as a unit. They move together
        // or they lie about each other (fresh-context critic, executed repro).
        //
        // `persistentAccountId` is PRESERVE-ON-NULL, because nothing is derived from it
        // and Plaid supplies it only at Tokenized-Account-Number institutions — a response
        // without one says nothing about the account, so writing null would erase the one
        // identifier that survives a re-link.
        subtype: m.subtype,
        ...(m.persistentAccountId ? { persistentAccountId: m.persistentAccountId } : {}),
      };
      const existing = await prisma.account.findFirst({
        where: { userId, provider: 'plaid', providerRef: m.providerRef },
        select: { id: true },
      });
      if (existing) {
        // null current → omit the field → Prisma leaves the last-known-good balance intact.
        await prisma.account.update({
          where: { id: existing.id },
          data:
            m.currentBalanceCents == null
              ? base
              : { ...base, currentBalanceCents: m.currentBalanceCents },
        });
      } else {
        // A brand-new account has no prior value to preserve; a null current stores 0.
        await prisma.account.create({
          data: {
            userId,
            provider: 'plaid',
            providerRef: m.providerRef,
            ...base,
            currentBalanceCents: m.currentBalanceCents ?? 0,
          },
        });
      }
    }
  }

  /** Map of Plaid account_id (providerRef) → our Account id, for the user. */
  private async plaidAccountIdMap(userId: string): Promise<Map<string, string>> {
    const accounts = await prisma.account.findMany({
      where: { userId, provider: 'plaid' },
      select: { id: true, providerRef: true },
    });
    return new Map(accounts.map((a) => [a.providerRef ?? '', a.id]));
  }

  /**
   * /transactions/sync across every linked item, with the stored cursor.
   * Added/modified rows are categorized through the standard pipeline and
   * upserted; removed rows are deleted; the cursor is persisted per item.
   * Cross-account transfer pairing runs once over the user's full set after.
   */
  async syncTransactions(userId: string, opts?: { itemId?: string }): Promise<SyncResult> {
    // `itemId` scopes the sweep to ONE linked bank, for the per-connection "Sync"
    // control. Always user-scoped as well, so a foreign itemId simply matches
    // nothing rather than syncing someone else's bank.
    const items = await prisma.plaidItem.findMany({
      where: { userId, ...(opts?.itemId ? { itemId: opts.itemId } : {}) },
    });
    const [rules, tuning] = await Promise.all([loadUserRules(userId), getThresholdTuning(userId)]);
    const today = this.today(userId); // stamp per-item sync success/failure (Gap 1 §4)
    let added = 0;
    let modified = 0;
    let removed = 0;
    let itemsFailed = 0;
    let lastCursor: string | null = null;

    for (const item of items) {
      try {
        const token = decryptToken(item.accessToken);

        // Refresh ALL of this item's account balances each sync (audit #6, DECISIONS #130).
        // `/accounts/get` returns EVERY account on the item — including INVESTMENT and LOAN —
        // with its latest balance. `/transactions/sync` only echoes accounts with transaction
        // activity (depository/credit), so without this an investment or loan balance would
        // FREEZE at link time and net worth would silently go stale. Best-effort + audited: a
        // balance-refresh failure (e.g. ITEM_LOGIN_REQUIRED) must never block transaction
        // ingest — the higher-value path — and the per-item catch below still retries the item.
        try {
          await this.syncAccountsForItem(userId, item.itemId);
        } catch (e) {
          await prisma.auditLog
            .create({
              data: {
                userId,
                action: 'plaid.accounts.refresh.failed',
                meta: JSON.stringify({
                  itemId: item.itemId,
                  error: e instanceof Error ? e.message : String(e),
                }),
              },
            })
            .catch(() => {});
        }

        let idByPlaidId = await this.plaidAccountIdMap(userId);

        let cursor = item.cursor ?? undefined;
        let hasMore = true;
        const removedRefs: string[] = []; // buffered across pages — applied after the loop
        while (hasMore) {
          const page = await plaidPost<{
            accounts?: PlaidAccount[];
            added: PlaidTransaction[];
            modified: PlaidTransaction[];
            removed: { transaction_id: string }[];
            next_cursor: string;
            has_more: boolean;
          }>('/transactions/sync', { access_token: token, cursor });

          // /transactions/sync echoes the item's current accounts. Upsert them so a
          // transaction for an account added to the item AFTER link is never silently
          // dropped while the cursor advances past it (a permanent ledger gap).
          if (page.accounts && page.accounts.length > 0) {
            await this.upsertPlaidAccounts(userId, page.accounts, item.itemId);
            idByPlaidId = await this.plaidAccountIdMap(userId);
          }

          // Pass 1: prepare the page's rows, then LLM-assist the unsure tail in
          // ONE deduped batch — Plaid-path parity with SimpleFIN/CSV/manual
          // (#163; the diagnosis flagged Plaid as the only ingest without
          // assist). No key → suggestCategoryViaLLM returns null → rows
          // unchanged (demo invariant). Pass 2 below is the original write
          // loop, byte-identical, over the assisted rows.
          const pageTxns = [...page.added, ...page.modified]
            .map((t) => ({ txn: t, accountId: idByPlaidId.get(t.account_id) }))
            // unmappable account (skipped at upsert) — don't orphan a row
            .filter((p): p is { txn: PlaidTransaction; accountId: string } => !!p.accountId);
          const preparedRows = pageTxns.map((p) =>
            prepareIngestedTransaction(p.txn, p.accountId, rules, tuning.flaggedBps),
          );
          // categorizeSuggestFor: demo fence (#242 F1 — a bank connected to the
          // shared demo account must not start egressing descriptors) + §3.2 sink.
          const assistedRows = await assistUnsureRows(preparedRows, categorizeSuggestFor(userId));

          for (let i = 0; i < pageTxns.length; i++) {
            const { txn, accountId } = pageTxns[i];
            const row = assistedRows[i];
            const merchant = await prisma.merchant.upsert({
              where: { canonical: row.merchantCanonical },
              create: { canonical: row.merchantCanonical, defaultCategoryId: row.categoryId },
              update: {},
            });
            const existing = await prisma.transaction.findFirst({
              where: { providerRef: row.providerRef, account: { userId } },
              select: { id: true },
            });
            // Split: what the BANK knows (always refreshed) vs the category VERDICT
            // (preserved on user-settled rows — a user decision outranks the pipeline;
            // Phase 3d + checker cycle 1: isTransfer is part of the VERDICT, a split
            // parent is never resurrected, and an UNDONE row — corrections exist but
            // it is back in review — takes the fresh verdict again).
            const base = {
              date: row.date,
              amountCents: row.amountCents,
              rawDescriptor: row.rawDescriptor,
              merchantId: merchant.id,
              status: row.status,
              // Plaid's own category guess for this row — a bank-supplied FACT (an
              // input, not the verdict), so it refreshes with the other feed facts on
              // every sync and rides `base` into every create/update site. Powers the
              // triage one-tap "Plaid's guess" suggestion (L.12); null for rows Plaid
              // couldn't categorize. Never auto-applied below the auto-file bar.
              providerCategoryId: row.providerCategoryId,
              providerCategoryConfidenceBps: row.providerCategoryConfidenceBps,
            };
            const data = {
              ...base,
              categoryId: row.categoryId,
              confidenceBps: row.confidenceBps,
              needsReview: row.needsReview,
              isTransfer: row.isTransfer,
            };
            // Check-then-act at SERIALIZABLE isolation (cycle-2 P1): under production
            // Postgres READ COMMITTED a fileMerchantGroup/applyCategory committing
            // between the in-tx read and the write was still clobbered; Serializable
            // turns that into a detected conflict → P2034 → serializableTx re-runs
            // against fresh state (DECISIONS #146). SQLite: single-writer, unchanged.
            const guardedVerdictRefresh = (id: string) =>
              serializableTx(async (tx) => {
                const fresh = await tx.transaction.findUnique({
                  where: { id },
                  select: { isSplitParent: true, needsReview: true, amountCents: true, reviewPinned: true },
                });
                // Deleted in the window (reconcile / removed[] / a dissolve) —
                // nothing to refresh; skip rather than throw (cycle-3 P2).
                if (!fresh) return;
                if (fresh.isSplitParent && fresh.amountCents !== row.amountCents) {
                  // The bank changed a SPLIT row's amount under the same id (pending
                  // tip/adjustment posting): the children no longer sum to the charge,
                  // so the split is stale — DISSOLVE it back to one row and FORCE it
                  // into review (cycle-3 P1): a destroyed user decision always
                  // re-decides; even the user's own merchant rule does not extend to
                  // a charge whose split the bank just broke (DECISIONS #147).
                  // reviewPinned makes the forced review DURABLE across re-sends
                  // (cycle-4 P1, DECISIONS #148).
                  await tx.transaction.deleteMany({ where: { splitParentId: id } });
                  await tx.transaction.update({
                    where: { id },
                    data: { ...data, isSplitParent: false, needsReview: true, confidenceBps: null, reviewPinned: true },
                  });
                  return;
                }
                const corrected =
                  (await tx.correction.count({ where: { transactionId: id } })) > 0;
                // reviewPinned holds a dissolve-forced review until a USER action
                // clears it (bank facts still refresh via base) — DECISIONS #148.
                const preserve =
                  fresh.isSplitParent || fresh.reviewPinned || (corrected && !fresh.needsReview);
                await tx.transaction.update({
                  where: { id },
                  data: preserve ? base : data,
                });
                if (fresh.isSplitParent) {
                  // A preserved split POSTS with its parent: children stuck PENDING
                  // forever would distort every pending projection (cycle-2 P0 family).
                  await tx.transaction.updateMany({
                    where: { splitParentId: id },
                    data: { status: row.status },
                  });
                }
              });
            if (existing) {
              await guardedVerdictRefresh(existing.id);
              modified++;
            } else {
              // Pending→posted id churn (checker P1): Plaid links a posted txn to its
              // pending predecessor via pending_transaction_id. Transplant the user's
              // settled verdict onto the new id — the old row is deleted (page.removed
              // will also name it), so without this the correction would be orphaned
              // and the decision silently reverted. EVERY predecessor read happens
              // INSIDE the serializable tx (cycle-2 P1: an outside read let a
              // correction landing in the window compute `settled` from a stale flag).
              const pendingRef =
                (txn as { pending_transaction_id?: string | null }).pending_transaction_id ?? null;
              const transplanted = pendingRef
                ? await serializableTx(async (tx) => {
                    const predecessor = await tx.transaction.findFirst({
                      where: { providerRef: pendingRef, account: { userId } },
                      select: {
                        id: true,
                        amountCents: true,
                        categoryId: true,
                        confidenceBps: true,
                        needsReview: true,
                        isTransfer: true,
                        isSplitParent: true,
                        reviewPinned: true,
                      },
                    });
                    if (!predecessor) return false;
                    if (predecessor.isSplitParent) {
                      // Cycle-2 P0: a split PENDING parent posting under a new id was
                      // deleted with isSplitParent dropped — children dangled (no FK)
                      // AND a new full-amount row double-counted the charge. Splitting
                      // a pending row is a SUPPORTED flow (critic2 F1 models the seeded
                      // pending Zelle split), so the churn must carry the split across.
                      const children = await tx.transaction.findMany({
                        where: { splitParentId: predecessor.id },
                        select: { id: true, amountCents: true },
                      });
                      const childSum = children.reduce((s, c) => s + c.amountCents, 0);
                      if (children.length > 0 && childSum === row.amountCents) {
                        // Amounts agree — the split survives verbatim: new container row,
                        // children re-pointed (and posted with it), corrections follow.
                        const container = await tx.transaction.create({
                          data: {
                            accountId,
                            providerRef: row.providerRef,
                            ...base,
                            categoryId: null,
                            confidenceBps: null,
                            needsReview: false,
                            isTransfer: predecessor.isTransfer,
                            isSplitParent: true,
                          },
                        });
                        await tx.transaction.updateMany({
                          where: { splitParentId: predecessor.id },
                          data: { splitParentId: container.id, status: row.status },
                        });
                        // Scoped by transactionId ONLY (not userId): since TASKS 4.2
                        // slice 6, a Correction's userId may be a household partner who
                        // one-off recategorized this row, not the syncing owner — every
                        // correction on this specific (already ownership-resolved via
                        // `predecessor`) transaction id legitimately transplants with it,
                        // regardless of who authored it (critic finding, slice 6).
                        await tx.correction.updateMany({
                          where: { transactionId: predecessor.id },
                          data: { transactionId: container.id },
                        });
                        // The prediction log follows the charge across id churn too
                        // (DECISIONS #190) — same "audit = state" rule as corrections.
                        await tx.categoryPrediction.updateMany({
                          where: { transactionId: predecessor.id, userId },
                          data: { transactionId: container.id },
                        });
                        await tx.transaction.delete({ where: { id: predecessor.id } });
                        return true;
                      }
                      // The bank changed the amount while pending (tip/adjustment): the
                      // split's parts no longer sum to the charge, and inventing an
                      // adjustment part would fabricate a row the user never made. The
                      // honest move is to DISSOLVE the stale split back into one row
                      // FORCED into review (cycle-3 P1: a destroyed user decision always
                      // re-decides — inheriting the pipeline verdict silently auto-filed
                      // ruled/known merchants, no triage card). Corrections still follow
                      // the charge (audit = state).
                      await tx.transaction.deleteMany({ where: { splitParentId: predecessor.id } });
                      const replacement = await tx.transaction.create({
                        data: {
                          accountId,
                          providerRef: row.providerRef,
                          ...data,
                          needsReview: true,
                          confidenceBps: null,
                          // Durable across re-sends (cycle-4 P1, DECISIONS #148).
                          reviewPinned: true,
                        },
                      });
                      // Scoped by transactionId only — see the container-path comment
                      // above (slice 6: a partner's correction transplants too).
                      await tx.correction.updateMany({
                        where: { transactionId: predecessor.id },
                        data: { transactionId: replacement.id },
                      });
                      await tx.categoryPrediction.updateMany({
                        where: { transactionId: predecessor.id, userId },
                        data: { transactionId: replacement.id },
                      });
                      await tx.transaction.delete({ where: { id: predecessor.id } });
                      return true;
                    }
                    if (predecessor.reviewPinned) {
                      // A PINNED row (dissolve-forced review, DECISIONS #148) that
                      // churns ids keeps its pin — otherwise the id churn would be a
                      // pin-laundering path and the rule verdict would land after all.
                      const pinned = await tx.transaction.create({
                        data: {
                          accountId,
                          providerRef: row.providerRef,
                          ...data,
                          needsReview: true,
                          confidenceBps: null,
                          reviewPinned: true,
                        },
                      });
                      // Scoped by transactionId only — see the container-path comment
                      // above (slice 6: a partner's correction transplants too).
                      await tx.correction.updateMany({
                        where: { transactionId: predecessor.id },
                        data: { transactionId: pinned.id },
                      });
                      await tx.categoryPrediction.updateMany({
                        where: { transactionId: predecessor.id, userId },
                        data: { transactionId: pinned.id },
                      });
                      await tx.transaction.delete({ where: { id: predecessor.id } });
                      return true;
                    }
                    const corrected =
                      (await tx.correction.count({ where: { transactionId: predecessor.id } })) > 0;
                    const settled = corrected && !predecessor.needsReview;
                    const created = await tx.transaction.create({
                      data: {
                        accountId,
                        providerRef: row.providerRef,
                        ...base,
                        categoryId: settled ? predecessor.categoryId : row.categoryId,
                        confidenceBps: settled ? predecessor.confidenceBps : row.confidenceBps,
                        needsReview: settled ? false : row.needsReview,
                        isTransfer: settled ? predecessor.isTransfer : row.isTransfer,
                      },
                    });
                    // Corrections follow the transaction across the id churn (audit =
                    // state). Scoped by transactionId only — not userId — since a
                    // Correction's userId may be a household partner who one-off
                    // recategorized this row (TASKS 4.2 slice 6); every correction on
                    // this (already ownership-resolved) transaction id transplants
                    // regardless of who authored it.
                    await tx.correction.updateMany({
                      where: { transactionId: predecessor.id },
                      data: { transactionId: created.id },
                    });
                    await tx.categoryPrediction.updateMany({
                      where: { transactionId: predecessor.id, userId },
                      data: { transactionId: created.id },
                    });
                    await tx.transaction.delete({ where: { id: predecessor.id } });
                    return true;
                  })
                : false;
              if (transplanted) {
                modified++;
              } else {
                try {
                  const createdRow = await prisma.transaction.create({
                    data: { accountId, providerRef: row.providerRef, ...data },
                  });
                  // Log the pipeline's verdict for the accuracy metric + threshold
                  // tuning (DECISIONS #190): the live-path counterpart of the seed's
                  // prediction log. After the create — a raced loser never logs.
                  await logCategoryPredictions(userId, [
                    {
                      transactionId: createdRow.id,
                      categoryId: row.categoryId,
                      confidenceBps: row.confidenceBps,
                      source: row.source,
                    },
                  ]);
                  added++;
                } catch (e) {
                  // Two overlapping syncs can both miss the findFirst and race the create
                  // (cycle-2 P2, the CQ-2 class): the loser lands here on the
                  // @@unique(accountId, providerRef) — take the guarded UPDATE path
                  // instead of aborting the whole sync loop.
                  if (!isUniqueViolation(e)) throw e;
                  const raced = await prisma.transaction.findFirst({
                    where: { providerRef: row.providerRef, account: { userId } },
                    select: { id: true },
                  });
                  if (raced) {
                    await guardedVerdictRefresh(raced.id);
                    modified++;
                  }
                }
              }
            }
          }

          // Buffer removed ids until every page is applied (cycle-2 P2): Plaid does
          // not guarantee the removed[pending-id] and its added[posted twin] share a
          // sync page — applying removes per page deleted the predecessor BEFORE the
          // transplant could find it, silently reverting the user's decision.
          removedRefs.push(...page.removed.map((r) => r.transaction_id));

          cursor = page.next_cursor;
          hasMore = page.has_more;
        }

        // Apply the buffered removes. A removed ref consumed by the transplant above
        // deletes nothing here (the predecessor row is already gone). Cascade: a
        // removed SPLIT PARENT takes its children with it — they are portions of a
        // charge that no longer exists, and leaving them counted phantom spending
        // (cycle-2 P0 family; pre-existing for canceled charges). The read runs
        // INSIDE the serializable tx (cycle-3 P2: an outside isSplitParent read
        // raced by a concurrent split re-orphaned the fresh children — the very
        // defect this cascade exists to prevent).
        for (let i = 0; i < removedRefs.length; i += 400) {
          const chunk = removedRefs.slice(i, i + 400);
          removed += await serializableTx(async (tx) => {
            const doomed = await tx.transaction.findMany({
              where: { providerRef: { in: chunk }, account: { userId } },
              select: { id: true, isSplitParent: true },
            });
            const parentIds = doomed.filter((d) => d.isSplitParent).map((d) => d.id);
            if (parentIds.length > 0) {
              await tx.transaction.deleteMany({ where: { splitParentId: { in: parentIds } } });
            }
            const res = await tx.transaction.deleteMany({
              where: { id: { in: doomed.map((d) => d.id) } },
            });
            return res.count;
          });
        }

        // Success: advance the cursor AND clear any prior failure signal (Gap 1 §4).
        await prisma.plaidItem.update({
          where: { id: item.id },
          data: { cursor, lastSyncedAt: today, lastSyncAttemptAt: today, lastSyncError: null },
        });
        lastCursor = cursor ?? null;
      } catch (e) {
        // One item in an error state (e.g. ITEM_LOGIN_REQUIRED needing re-auth) must
        // not block the user's other items. Record + continue; this item's cursor is
        // left unadvanced so a later sweep retries it once the user re-auths.
        //
        // COUNTED, not only audited: isolation used to make a failure invisible to the
        // caller — `added: 0` and no error, which the per-bank Sync flash then reported
        // as "0 new transactions" to someone whose bank had just refused them. The count
        // is what lets a caller tell "nothing new" from "nothing got through".
        itemsFailed += 1;
        await prisma.auditLog
          .create({
            data: {
              userId,
              action: 'plaid.item.sync.failed',
              meta: JSON.stringify({ itemId: item.itemId, error: e instanceof Error ? e.message : String(e) }),
            },
          })
          .catch(() => {});
        // Gap 1 §4: persist a SANITIZED per-item failure signal (never the raw error) so
        // this item surfaces a reconnect prompt; leave lastSyncedAt (last good data) intact.
        await prisma.plaidItem
          .update({ where: { id: item.id }, data: { lastSyncAttemptAt: today, lastSyncError: safeSyncErrorReason(e) } })
          .catch(() => {});
      }
    }

    // Re-derive isTransfer across the user's full set (descriptor + pair
    // matching), filing still-in-review pairs — shared helper, one
    // implementation for every sync source (#165).
    await refreshTransferFlags(userId);

    // Recompute recurring series + the detected scheduled projections from the
    // freshly-ingested data (DECISIONS #22 tail). Best-effort: a derived-projection
    // failure must never fail the ingest itself.
    try {
      await refreshRecurringForUser(userId, this.today(userId));
    } catch {
      // detection is a derived view; the ingest already succeeded
    }

    return { added, modified, removed, nextCursor: lastCursor, itemsFailed };
  }

  /**
   * /liabilities/get → upsert a Statement per credit card with a generated cycle, AND
   * populate each mortgage/student LOAN account's rate + fixed monthly payment + due day
   * (#134). Without the loan branch a linked mortgage/student loan carries only a balance:
   * its APR stays 0 (the debt-payoff planner mis-computes) and its payment/due-date never
   * surface on the calendar or reminders.
   */
  async syncLiabilities(userId: string, opts?: { itemId?: string }): Promise<LiabilitySyncResult> {
    // Per-item errors are caught below so one bad item can't cost the others their
    // data — but that means a caller could never tell a fully-failed sweep from a
    // clean one (critic F-6). The counts are the honest signal: they make a silent
    // total failure visible to the cron's audit row.
    let itemsAttempted = 0;
    let itemsFailed = 0;
    let itemsUnsupported = 0;
    let statementsWritten = 0;
    // Same user-scoped per-item narrowing as syncTransactions.
    const items = await prisma.plaidItem.findMany({
      where: { userId, ...(opts?.itemId ? { itemId: opts.itemId } : {}) },
    });
    const accounts = await prisma.account.findMany({
      where: { userId, provider: 'plaid' },
      select: { id: true, providerRef: true },
    });
    const idByPlaidId = new Map(accounts.map((a) => [a.providerRef ?? '', a.id]));

    // Write only the loan fields Plaid actually reported (each non-null), so a missing
    // rate/payment/due-day PRESERVES the last-known-good value instead of zeroing it — the
    // #130 preserve-on-null discipline applied to mortgage/student liabilities.
    const applyLoanFields = async (plaidAccountId: string | null, f: MappedLoanFields) => {
      const accountId = plaidAccountId ? idByPlaidId.get(plaidAccountId) : undefined;
      if (!accountId) return; // student account_id is nullable; an unjoinable row is skipped
      const data: { aprBps?: number; minimumPaymentCents?: number; dueDayOfMonth?: number } = {};
      if (f.aprBps !== null) data.aprBps = f.aprBps;
      if (f.minimumPaymentCents !== null) data.minimumPaymentCents = f.minimumPaymentCents;
      if (f.dueDayOfMonth !== null) data.dueDayOfMonth = f.dueDayOfMonth;
      if (Object.keys(data).length > 0) {
        await prisma.account.update({ where: { id: accountId }, data });
      }
    };

    for (const item of items) {
      itemsAttempted += 1;
      try {
        const token = decryptToken(item.accessToken);
        const { liabilities } = await plaidPost<{
          liabilities: {
            credit?: PlaidCreditLiability[];
            mortgage?: PlaidMortgageLiability[];
            student?: PlaidStudentLiability[];
          };
        }>('/liabilities/get', { access_token: token });
        for (const mortgage of liabilities.mortgage ?? []) {
          await applyLoanFields(mortgage.account_id, mapPlaidMortgageToLoanFields(mortgage));
        }
        for (const student of liabilities.student ?? []) {
          await applyLoanFields(student.account_id, mapPlaidStudentToLoanFields(student));
        }
        for (const credit of liabilities.credit ?? []) {
          const accountId = idByPlaidId.get(credit.account_id);
          if (!accountId) continue;
          // Persist the card's APR (audit #126-followup): without this aprBps stays null/0 and the
          // debt-payoff + cash-needed engines compute ZERO interest on a real Plaid card. Set it even
          // when no statement has generated yet — the rate doesn't depend on a cycle. Null → leave as-is.
          const aprBps = pickPlaidAprBps(credit);
          if (aprBps !== null) {
            await prisma.account.update({ where: { id: accountId }, data: { aprBps } });
          }
          // Record whichever cycle days Plaid DID report, even when it reported too
          // little for a full statement (critic F-7). The engine's estimate path
          // needs BOTH cycleCloseDayOfMonth and dueDayOfMonth, and nothing in the
          // Plaid path ever wrote either for a credit card — so a card whose issuer
          // returns, say, a due date but no statement issue date was permanently
          // undatable, and the "estimate path covers it" comment below was false.
          // Preserve-on-null (#130): a missing field never clears a known value.
          const cycleDays: { cycleCloseDayOfMonth?: number; dueDayOfMonth?: number } = {};
          const closeDay = dayOfMonthFromISO(credit.last_statement_issue_date);
          const dueDay = dayOfMonthFromISO(credit.next_payment_due_date);
          if (closeDay !== null) cycleDays.cycleCloseDayOfMonth = closeDay;
          if (dueDay !== null) cycleDays.dueDayOfMonth = dueDay;
          if (Object.keys(cycleDays).length > 0) {
            await prisma.account.update({ where: { id: accountId }, data: cycleDays });
          }

          const stmt = mapPlaidLiabilityToStatement(credit, accountId);
          if (!stmt) continue; // no generated statement → cash-needed estimate path
          // Count only statements that actually CHANGED. Counting every upsert made
          // a second sync report "2 card statements updated" again, which undercuts
          // the one thing this number exists to say — whether anything moved
          // (critic P2-3). The read also lets an unchanged row skip its write.
          const existing = await prisma.statement.findUnique({
            where: { accountId_cycleEnd: { accountId, cycleEnd: stmt.cycleEnd } },
            select: {
              dueDate: true,
              statementBalanceCents: true,
              minimumPaymentCents: true,
            },
          });
          const unchanged =
            existing !== null &&
            existing.dueDate === stmt.dueDate &&
            existing.statementBalanceCents === stmt.statementBalanceCents &&
            existing.minimumPaymentCents === stmt.minimumPaymentCents;
          if (unchanged) continue;
          statementsWritten += 1;
          await prisma.statement.upsert({
            where: { accountId_cycleEnd: { accountId, cycleEnd: stmt.cycleEnd } },
            create: {
              accountId,
              cycleStart: stmt.cycleEnd, // Plaid does not expose cycle start; cycleEnd anchors the cycle
              cycleEnd: stmt.cycleEnd,
              dueDate: stmt.dueDate,
              statementBalanceCents: stmt.statementBalanceCents,
              minimumPaymentCents: stmt.minimumPaymentCents,
              isEstimated: false,
            },
            update: {
              dueDate: stmt.dueDate,
              statementBalanceCents: stmt.statementBalanceCents,
              minimumPaymentCents: stmt.minimumPaymentCents,
            },
          });
        }
      } catch (e) {
        // A depository-only item has no Liabilities product (PRODUCTS_NOT_SUPPORTED),
        // and a freshly-linked item may not have generated liability data yet. Neither
        // must abort liability sync for the user's OTHER items (nor fail a link).
        // Counted, so a caller can tell a total failure from a clean run. Audit + continue.
        //
        // "The issuer has nothing here" and "the sync is broken" shared one count and
        // one audit action, so a checking-only item wrote plaid.liabilities.failed
        // every day forever (#277 P2). Plaid's own error_code — which plaidPost bakes
        // into the thrown message verbatim (plaidErrorSummary) — separates them:
        // PRODUCTS_NOT_SUPPORTED / NO_LIABILITY_ACCOUNTS are the documented
        // "no liability data on this item" answers, expected rather than broken.
        const message = e instanceof Error ? e.message : String(e);
        const unsupported = /\b(?:PRODUCTS_NOT_SUPPORTED|NO_LIABILITY_ACCOUNTS)\b/.test(message);
        if (unsupported) itemsUnsupported += 1;
        else itemsFailed += 1;
        await prisma.auditLog
          .create({
            data: {
              userId,
              action: unsupported ? 'plaid.liabilities.unsupported' : 'plaid.liabilities.failed',
              meta: JSON.stringify({ itemId: item.itemId, error: message }),
            },
          })
          .catch(() => {});
      }
    }
    return { itemsAttempted, itemsFailed, itemsUnsupported, statementsWritten };
  }

  /**
   * /investments/holdings/get → upsert each INVESTMENT account's positions into `Holding`
   * (TASKS 4.3, the Plaid parity of syncFromSimplefin's holdings branch). Holdings are a
   * within-account breakdown for /investments; net worth stays on the account balance
   * (already refreshed by the account sync), so this never moves a total (DECISIONS #124).
   *
   * Cost-aware: production Plaid calls are billed per request, so a user with NO investment
   * account makes ZERO calls, and a checking/credit-only bank is never asked (it would only
   * answer PRODUCTS_NOT_SUPPORTED). Per-item fault isolation + the unsupported/failed audit
   * split mirror syncLiabilities exactly. UNVERIFIED against live Plaid (no sandbox creds).
   */
  async syncHoldings(userId: string, opts?: { itemId?: string }): Promise<HoldingsSyncResult> {
    let itemsAttempted = 0;
    let itemsFailed = 0;
    let itemsUnsupported = 0;
    let upserted = 0;
    let removed = 0;
    let skipped = 0;
    let withheldNonUsd = 0;

    // Only INVESTMENT accounts carry holdings. A user with none (the common checking/credit-
    // only case, e.g. the owner's Chase + Capital One) short-circuits to zero billed calls.
    const investmentAccounts = await prisma.account.findMany({
      where: { userId, provider: 'plaid', type: 'INVESTMENT' },
      // feedDroppedAt is selected because the prune decision below reads it (TASKS L.14).
      select: { id: true, providerRef: true, plaidItemId: true, feedDroppedAt: true },
    });
    if (investmentAccounts.length === 0) {
      return { itemsAttempted, itemsFailed, itemsUnsupported, upserted, removed, skipped, withheldNonUsd };
    }

    // Same user-scoped per-item narrowing as syncTransactions/syncLiabilities.
    const items = await prisma.plaidItem.findMany({
      where: { userId, ...(opts?.itemId ? { itemId: opts.itemId } : {}) },
    });

    for (const item of items) {
      // Ask a bank for holdings ONLY when it has an investment account (billed per request).
      // Linkage self-heals: a new investment account stamps plaidItemId on the account sync
      // that precedes every holdings sync, so a legacy null-linked row is picked up next run.
      const itemInvestmentAccounts = investmentAccounts.filter((a) => a.plaidItemId === item.itemId);
      if (itemInvestmentAccounts.length === 0) continue;
      itemsAttempted += 1;
      try {
        const token = decryptToken(item.accessToken);
        const { holdings: rawHoldings, securities } = await plaidPost<{
          holdings?: PlaidHolding[];
          securities?: PlaidSecurity[];
        }>('/investments/holdings/get', { access_token: token });
        // A well-formed /investments/holdings/get 200 always carries a holdings ARRAY (empty =
        // "sold everything"). A MISSING / null / non-array holdings (a truncated or garbled-but-
        // 200 body, proxy corruption, schema drift) must NOT be read as "no positions" — that
        // would WIPE the synced breakdown, the #128 `transactions: null` hazard the SimpleFIN
        // sibling guards with Array.isArray (simplefin.ts:502). Leave every account's rows intact
        // this run and record it; a clean 200 next sweep reconciles normally.
        if (!Array.isArray(rawHoldings)) {
          await prisma.auditLog
            .create({ data: { userId, action: 'plaid.holdings.malformed', meta: JSON.stringify({ itemId: item.itemId }) } })
            .catch(() => {});
          continue;
        }
        const allSecurities = Array.isArray(securities) ? securities : [];
        for (const acct of itemInvestmentAccounts) {
          const rawForAccount = rawHoldings.filter((h) => h.account_id === acct.providerRef);
          const mapped = mapPlaidHoldings(rawForAccount, allSecurities);
          withheldNonUsd += mapped.withheldNonUsd; // counted once, independent of whether we prune
          // Upsert whatever mapped, but PRUNE stale rows ONLY on a CLEAN run (skipped === 0). A
          // run that left un-mappable rows (skipped > 0 — e.g. a truncated securities[] that
          // dropped a still-held position's security, or a genuinely un-keyable position) might
          // be hiding a position we still hold, so "absent from the mapped set" must NOT be read
          // as "sold". An explicit-empty, cash-only, or all-foreign account is skipped === 0 →
          // prunes correctly (a real sell-all). This subsumes the old "don't wipe on an all-
          // un-mappable feed" guard: 0 mapped + skipped > 0 upserts nothing and prunes nothing.
          // …and NEVER prune an account the feed has stopped carrying (TASKS L.14, critic F-2).
          // Its holdings are absent from this payload for the same reason the account is: it was
          // unticked, not sold. Pruning deleted every position, so /investments showed a portfolio
          // $50k smaller — or the "No investment holdings yet" empty state — while net worth still
          // counted the balance and the app was telling the reader it was counted everywhere. That
          // is this module's own "absent is not sold" argument (#290) one level up, and it is what
          // makes the shipped disclosure true rather than merely qualified.
          const rec = await this.reconcilePlaidHoldings(
            acct.id,
            mapped.holdings,
            mapped.skipped === 0 && acct.feedDroppedAt == null,
          );
          upserted += rec.upserted;
          removed += rec.removed;
          skipped += mapped.skipped + rec.skipped;
        }
      } catch (e) {
        // An item linked BEFORE `investments` was requested (or an institution that doesn't
        // support it) answers PRODUCTS_NOT_SUPPORTED — the issuer's own "nothing here",
        // expected rather than broken. Split from real failures so a re-link-needed item
        // doesn't paint every holdings sweep red (the #277 P2 liabilities lesson).
        const message = e instanceof Error ? e.message : String(e);
        const unsupported = /\b(?:PRODUCTS_NOT_SUPPORTED|NO_INVESTMENT_ACCOUNTS)\b/.test(message);
        if (unsupported) itemsUnsupported += 1;
        else itemsFailed += 1;
        await prisma.auditLog
          .create({
            data: {
              userId,
              action: unsupported ? 'plaid.holdings.unsupported' : 'plaid.holdings.failed',
              meta: JSON.stringify({ itemId: item.itemId, error: message }),
            },
          })
          .catch(() => {});
      }
    }
    return { itemsAttempted, itemsFailed, itemsUnsupported, upserted, removed, skipped, withheldNonUsd };
  }

  /**
   * Reconcile ONE Plaid investment account's positions: upsert the feed's source='plaid'
   * rows, prune stale source='plaid' rows (sold), and NEVER touch a row written by anything
   * else. This generalizes reconcileSimplefinHoldings's manual-protection to a cross-provider
   * invariant — "a feed touches only its OWN source rows" — so a user's manually-entered
   * position (and, defensively, any other provider's row) is off-limits to both the upsert
   * and the delete. Resilient: a single position's DB error is counted (skipped), not thrown.
   */
  private async reconcilePlaidHoldings(
    accountId: string,
    holdings: readonly MappedPlaidHolding[],
    /** Prune stale source='plaid' rows? Only on a CLEAN run (no un-mappable feed rows): a
     *  partial run upserts what it can WITHOUT deleting positions it may have failed to map. */
    prune: boolean,
  ): Promise<{ upserted: number; removed: number; skipped: number }> {
    // Off-limits to the Plaid feed (upsert AND delete): every symbol NOT owned by Plaid.
    const offLimits = new Set(
      (
        await prisma.holding.findMany({
          where: { accountId, NOT: { source: 'plaid' } },
          select: { symbol: true },
        })
      ).map((h) => h.symbol),
    );

    let upserted = 0;
    let skipped = 0;
    for (const hld of holdings) {
      if (offLimits.has(hld.symbol)) {
        skipped++; // a manual (or other-provider) ticker the feed also reports — leave it intact
        continue;
      }
      const fields = {
        name: hld.name,
        quantity: hld.quantity,
        costBasisCents: hld.costBasisCents,
        priceCents: hld.priceCents,
        // Authoritative TOTAL market value (DECISIONS #129) — stored so the engine reports
        // Plaid's real position value instead of reconstructing from a rounded per-share price.
        marketValueCents: hld.marketValueCents,
        source: 'plaid',
      };
      try {
        await prisma.holding.upsert({
          where: { accountId_symbol: { accountId, symbol: hld.symbol } },
          create: { accountId, symbol: hld.symbol, ...fields },
          update: fields,
        });
        upserted++;
      } catch {
        skipped++; // one position's write hiccup shouldn't lose the rest
      }
    }

    // Delete sold positions — ONLY our own synced rows (manual/other-provider rows never in
    // scope), and ONLY on a clean run (prune). An explicit empty set means every previously-
    // synced Plaid position is gone (sold-all). A partial run (prune=false) deletes nothing.
    let removed = 0;
    if (prune) {
      const syncedSymbols = holdings.filter((h) => !offLimits.has(h.symbol)).map((h) => h.symbol);
      ({ count: removed } =
        syncedSymbols.length === 0
          ? await prisma.holding.deleteMany({ where: { accountId, source: 'plaid' } })
          : await prisma.holding.deleteMany({
              where: { accountId, source: 'plaid', symbol: { notIn: syncedSymbols } },
            }));
    }
    return { upserted, removed, skipped };
  }


  async listAccounts(userId: string) {
    return prisma.account.findMany({ where: { userId }, orderBy: { id: 'asc' } });
  }

  async getStatements(userId: string, accountId: string) {
    return prisma.statement.findMany({
      where: { accountId, account: { userId } },
      orderBy: { cycleEnd: 'desc' },
    });
  }

  /**
   * Register the configured webhook (PLAID_WEBHOOK_URL) on the user's already-
   * linked items via /item/webhook/update. New links carry the webhook from
   * linkTokenParams at creation time; this backfills items linked BEFORE the
   * webhook was configured, which otherwise never receive TRANSACTIONS pushes and
   * drift stale between manual syncs (the #278 "hasn't synced in a week" class,
   * root-caused to no webhook being registered at all).
   *
   * Idempotent + self-healing: each item records the webhook we last set on it
   * (PlaidItem.webhookUrl), so we spend a (billed) Plaid call ONLY when it differs
   * from the desired URL — and re-register automatically if PLAID_WEBHOOK_URL later
   * changes. Returns attempted:0 when the env is unset (nothing to register), so a
   * caller can run it unconditionally. Per-item fault isolation, matching
   * syncTransactions: one item's failure is audited and skipped, never blocking the
   * rest. Always user-scoped, so a foreign itemId simply matches nothing.
   */
  async updateWebhooks(userId: string, opts?: { itemId?: string }): Promise<WebhookUpdateResult> {
    const desired = process.env.PLAID_WEBHOOK_URL?.trim();
    if (!desired) return { attempted: 0, updated: 0, failed: 0 };

    const items = await prisma.plaidItem.findMany({
      where: { userId, ...(opts?.itemId ? { itemId: opts.itemId } : {}) },
    });
    let attempted = 0;
    let updated = 0;
    let failed = 0;
    for (const item of items) {
      // Already registered with this exact URL — skip the billed call. This is what
      // keeps calling updateWebhooks on every sync cheap: one call per item, once.
      if (item.webhookUrl === desired) continue;
      attempted += 1;
      try {
        const token = decryptToken(item.accessToken);
        await plaidPost<{ item?: unknown }>('/item/webhook/update', {
          access_token: token,
          webhook: desired,
        });
        // Record only AFTER Plaid accepts it, so a failed call leaves webhookUrl
        // unchanged and the next sweep retries rather than assuming success.
        await prisma.plaidItem.update({
          where: { itemId: item.itemId },
          data: { webhookUrl: desired },
        });
        updated += 1;
      } catch (e) {
        failed += 1;
        // Best-effort audit — plaidPost's message carries Plaid's RESPONSE envelope
        // only (no access_token), so it is safe to record; a failed audit must not
        // itself break the sweep.
        try {
          await prisma.auditLog.create({
            data: {
              userId,
              action: 'plaid.item.webhook.update.failed',
              meta: JSON.stringify({
                itemId: item.itemId,
                error: e instanceof Error ? e.message : 'unknown error',
              }),
            },
          });
        } catch {
          /* audit is diagnostic only */
        }
      }
    }
    return { attempted, updated, failed };
  }

  /**
   * Resolve a linked item's institution from Plaid: /item/get → `institution_id`, then —
   * only when the name is what's wanted — /institutions/get_by_id → "Chase", "Capital One".
   *
   * Two different things come back and they are not interchangeable. The NAME is cosmetic:
   * it labels a connection row on /accounts. The `ins_*` ID is identity — it is what lets
   * the app ask "is this bank already connected?" *before* writing a second copy of an
   * account the user already has (docs/ACCOUNT_IDENTITY_ARCHITECTURE.md §4 layer 2). Either
   * may be null: an item can expose no institution_id (rare — e.g. some manually-created
   * sandbox items), and a blank name counts as no name.
   *
   * The two halves are fetched by two separate calls, kept separate on purpose: Plaid bills
   * per request, so a caller that needs only one must be able to buy only one — and a
   * failure of the cosmetic half must not discard the identity half already in hand.
   *
   * `accessToken` is the RAW (decrypted) token. Throws only on a network/Plaid error from
   * the /item/get leg, which every caller isolates — none of this may ever block a link or
   * a data sync.
   */
  private async resolveInstitution(
    accessToken: string,
  ): Promise<{ institutionId: string | null; name: string | null }> {
    const institutionId = await this.resolveInstitutionId(accessToken);
    if (!institutionId) return { institutionId: null, name: null };
    try {
      return { institutionId, name: await this.institutionNameFor(institutionId) };
    } catch {
      // The name is cosmetic and the sweep retries it. The id is identity and is already
      // paid for — throwing it away with the failed second call is the expensive half of
      // the loss, and would leave layer 2 blind at exactly the bank whose rows are hardest
      // to tell apart (an unnamed one).
      return { institutionId, name: null };
    }
  }

  /** /item/get → the bank's stable `ins_*` id, or null when the item exposes none. */
  private async resolveInstitutionId(accessToken: string): Promise<string | null> {
    const { item } = await plaidPost<{ item: { institution_id?: string | null } }>('/item/get', {
      access_token: accessToken,
    });
    return item?.institution_id?.trim() || null;
  }

  /** /institutions/get_by_id → the human name, or null when Plaid returns a blank one. */
  private async institutionNameFor(institutionId: string): Promise<string | null> {
    const { institution } = await plaidPost<{ institution: { name?: string | null } }>(
      '/institutions/get_by_id',
      { institution_id: institutionId, country_codes: ['US'] },
    );
    const name = institution?.name?.trim();
    return name ? name : null;
  }

  /**
   * Backfill what an item knows about its bank: the human NAME (items linked before
   * institution capture existed, or whose link-time lookup failed, read "Connected bank" on
   * /accounts until named — owner-reported 2026-07-23: two linked banks both showing
   * "Plaid: Connected bank", indistinguishable) and the `ins_*` INSTITUTION ID (every item
   * linked before that column existed, including every item the owner has today).
   *
   * Mirrors updateWebhooks: idempotent (the WHERE selects only items missing one of the two,
   * so once an item is fully resolved this spends no billed call at all), per-item fault
   * isolation (one bank's failure is audited and skipped, never blocking the rest), always
   * user-scoped (a foreign itemId matches nothing).
   */
  async syncInstitutions(
    userId: string,
    opts?: { itemId?: string },
  ): Promise<InstitutionSyncResult> {
    // Demo fence in the CORE, not at the call sites (the removeItem precedent, and the
    // lesson behind it: a rule enforced per call site gets missed at a call site). The
    // shared demo row must never cause a real Plaid request, whoever calls this.
    if (isDemoUser(userId)) return { attempted: 0, updated: 0, failed: 0 };
    const items = await prisma.plaidItem.findMany({
      where: {
        userId,
        // Either half missing is reason enough to look. A name-but-no-id item is the COMMON
        // case after this column shipped, and it is exactly the one that must be swept: the
        // id is what layer 2 needs, and nothing else ever fetches it.
        OR: [{ institution: null }, { institutionId: null }],
        ...(opts?.itemId ? { itemId: opts.itemId } : {}),
      },
    });
    let attempted = 0;
    let updated = 0;
    let failed = 0;
    for (const item of items) {
      attempted += 1;
      // Written OUTSIDE the try so a half that landed still counts when the other half
      // throws — the two are bought separately and can succeed separately.
      let wrote = false;
      try {
        // Read the id FRESH. Only items missing a half are selected at all, and the name
        // is resolved FROM the id — so remembering a previously-stored id here would mean
        // looking a name up against an id that may have moved (a bank migration re-keys an
        // item's institution_id), writing the OLD bank's name and reporting a clean
        // success. It would also leave collision interception comparing against an id the
        // institution no longer uses, at exactly the bank a user is most likely re-linking.
        const institutionId = await this.resolveInstitutionId(decryptToken(item.accessToken));
        if (institutionId && institutionId !== item.institutionId) {
          // The identity half is persisted FIRST and on its own, so a flaky name lookup
          // cannot cost the app the thing collision interception actually needs.
          await prisma.plaidItem.update({ where: { itemId: item.itemId }, data: { institutionId } });
          wrote = true;
        }
        if (item.institution == null && institutionId) {
          const name = await this.institutionNameFor(institutionId);
          if (name) {
            await prisma.plaidItem.update({
              where: { itemId: item.itemId },
              data: { institution: name },
            });
            wrote = true;
          }
        }
        // Nothing resolved → the item exposes no institution; leave it and do NOT
        // count a failure (a failure implies a retryable error, which this isn't).
      } catch (e) {
        failed += 1;
        try {
          await prisma.auditLog.create({
            data: {
              userId,
              action: 'plaid.institution.resolve.failed',
              meta: JSON.stringify({
                itemId: item.itemId,
                error: e instanceof Error ? e.message : 'unknown error',
              }),
            },
          });
        } catch {
          /* audit is diagnostic only */
        }
      }
      if (wrote) updated += 1;
    }
    return { attempted, updated, failed };
  }

  async getFinanceSnapshot(userId: string): Promise<FinanceSnapshot> {
    // After sync, the DB is the source of truth — identical read path to demo.
    return new DemoProvider().getFinanceSnapshot(userId);
  }

  /** Decrypt the access token for one item (ownership-scoped). */
  private async accessTokenFor(userId: string, itemId: string): Promise<string> {
    // Scalar-validate in the CORE, so every current and future caller inherits it rather
    // than each remembering to. TypeScript's `string` is erased at a server-action
    // boundary, and an object reaching a Prisma `where` does not fail — it MATCHES,
    // silently selecting this user's first item instead of the one named (#279 found the
    // same shape one layer up). Safe by construction, not by data.
    if (typeof itemId !== 'string' || itemId.trim() === '') {
      throw new Error('No linked Plaid item for this user');
    }
    const item = await prisma.plaidItem.findFirst({ where: { userId, itemId } });
    if (!item) throw new Error(`No linked Plaid item ${itemId} for this user`);
    return decryptToken(item.accessToken);
  }

  /** Data deletion (docs/PRIVACY.md): revoke each item at Plaid, then cascade. */
  /**
   * Revoke ONE access token at Plaid. Split out of `removeItem` for the combine flow (TASKS
   * L.10), which deletes the connection row inside its own claim transaction and therefore has
   * the token in hand but no row left for `removeItem` to look up. Does nothing else: no
   * stamping, no row deletion, no audit — the caller owns those.
   */
  async revokeAccessToken(userId: string, accessToken: string): Promise<void> {
    const token = decryptToken(accessToken);
    // Same LAST-CHANCE identity capture `removeItem` does: after the revoke these rows are
    // unreachable, and they are exactly the population a later identity comparison works on.
    // Best-effort — a failed lookup must never block the revoke the user asked for.
    try {
      const { accounts } = await plaidPost<{
        accounts: { account_id: string; subtype?: string | null; persistent_account_id?: string | null }[];
      }>('/accounts/get', { access_token: token });
      await stampAccountIdentity(userId, accounts);
    } catch {
      // identity capture is an optimization, never a blocker for revocation
    }
    await plaidPost('/item/remove', { access_token: token });
  }

  async removeItem(userId: string, itemId: string): Promise<void> {
    // Demo fence in the CORE (fence-by-construction; #256 critic P2-3): the shared
    // demo row owns no PlaidItem today, but a mutation this destructive must be
    // safe by construction, not by data — every current and future caller inherits it.
    if (isDemoUser(userId)) return;
    const items = await prisma.plaidItem.findMany({ where: { userId, itemId } });
    for (const item of items) {
      // Best-effort item→account stamping BEFORE the token is revoked (#256): rows
      // created before plaidItemId existed may not have re-synced yet, and after
      // /item/remove the linkage is unrecoverable. A failed /accounts/get (e.g. a
      // long-broken login) is non-fatal — unstamped rows just stay on the
      // conservative zero-items delete rule.
      try {
        const token = decryptToken(item.accessToken);
        const { accounts } = await plaidPost<{
          accounts: { account_id: string; subtype?: string | null; persistent_account_id?: string | null }[];
        }>('/accounts/get', { access_token: token });
        await prisma.account.updateMany({
          where: { userId, provider: 'plaid', providerRef: { in: accounts.map((a) => a.account_id) } },
          data: { plaidItemId: itemId },
        });
        // LAST CHANCE to learn who these accounts are (L.10 slice 1, critic P1-1). This
        // response already carries their identity and the call is already paid for; a
        // second later the token is revoked and the item row is deleted, while the
        // ACCOUNT rows are deliberately kept — and nothing revisits them, because every
        // sync path iterates PlaidItem. Without this, every row a user disconnects is
        // permanently identity-less, which is precisely the population the reconciliation
        // flow works on: the app's own advice for a duplicate is "disconnect one side,
        // then combine". Preserve-on-null, same rule as the sync path; per-row rather
        // than one updateMany because each row's values are its own.
        await stampAccountIdentity(userId, accounts);
      } catch {
        // stamping is an optimization for delete-precision, never a blocker for revocation
      }
      // WHO these accounts bank with, stamped onto the rows before the connection row that
      // holds it is deleted (L.10). Needs no Plaid call — the values are already in hand — so
      // it runs outside the best-effort block above.
      await stampConnectionIdentity(userId, item);
      await plaidPost('/item/remove', { access_token: decryptToken(item.accessToken) });
    }
    await prisma.plaidItem.deleteMany({ where: { userId, itemId } });
    await prisma.auditLog.create({
      data: {
        userId,
        action: 'plaid.item.remove',
        meta: JSON.stringify({ itemId, tokensRevoked: items.length }),
      },
    });
  }
}
