'use server';

/**
 * Plaid Link server actions (DECISIONS #41) — the front door to the already-
 * validated PlaidProvider ingest (sandbox-proven, ROADMAP #1a). Used directly
 * (not via the DataProvider seam) so linking works regardless of DATA_PROVIDER.
 * Both degrade gracefully when Plaid isn't configured (no keys → {ok:false}),
 * preserving the zero-credential demo.
 */
import { revalidatePath } from 'next/cache';
import { recordMonthlyBalanceSnapshot } from '@/server/balance-history';
import { accountShapeDigest } from '@/server/sync-change-digest';
import { revalidateAfterSync } from '@/server/sync-revalidate';
import { prisma } from '@/lib/db';
import { DEMO_CONNECT_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { PlaidProvider } from '@/lib/providers/plaid';
import {
  alreadyConnectedFlash,
  linkedForHistoryFlash,
  linkedWithOverlapFlash,
} from '@/components/finance/plaid-update-copy';
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
  /**
   * A sentence to show the user about WHAT HAPPENED to their link, when it was anything other
   * than the ordinary "a new connection was created" (TASKS L.10 layer 2 — a redundant link
   * refused, or an overlapping one kept). Never an error: in both states the user ends up with
   * every account they asked for. Absent on an ordinary link, which needs no narration.
   */
  notice?: string;
}

/** Update-mode token mints per user per window. A tap opens a bank window, so a human
 *  cannot legitimately need many; this only stops an unbounded loop of billed calls. */
const UPDATE_TOKEN_LIMIT = 10;
const UPDATE_TOKEN_WINDOW_MS = 60_000;

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
 * Reopen Link on a bank the user ALREADY has, in Plaid's update mode (TASKS L.10
 * layer 1). Two jobs, one control: add an account that wasn't shared the first time,
 * and repair a connection whose login has expired.
 *
 * The reason this exists is that the alternative — "just link it again" — is what
 * manufactures duplicates. A second Link session at the same bank mints a new Item and
 * therefore new `account_id`s, so the same real card arrives as a brand-new row that no
 * heuristic can safely merge afterwards. Through THIS path every already-linked account
 * returns with its existing id and takes the account upsert's update branch, which is a
 * refresh: no second copy of an account the user already had, so nothing for the
 * duplicate detector to find. Rows ARE still written — a newly shared account and its
 * transactions are the point — and the front door remains as capable of duplicating as
 * it ever was until layer 2 ships.
 *
 * The token it returns must NOT be exchanged — see `linkPlaidAccount`.
 */
export async function createPlaidUpdateLinkToken(itemId: string): Promise<LinkTokenResult> {
  try {
    const userId = await requireUserId();
    if (isDemoUser(userId)) return { ok: false, error: DEMO_CONNECT_BLOCKED };
    if (!plaidConfigured()) {
      return { ok: false, error: 'Bank linking isn’t configured yet (Plaid keys not set).' };
    }
    // Scalar-validate before the id reaches any Prisma `where` (#279): a server-action
    // argument is attacker-controlled and TypeScript's `string` is erased at the
    // boundary, so an object could otherwise match a row that isn't the one named.
    if (typeof itemId !== 'string' || itemId.trim() === '') {
      return { ok: false, error: 'That bank isn’t connected.' };
    }
    // Every call decrypts a live access token and buys a Plaid request, so it is gated
    // like the other per-item paths (syncPlaidNow, updatePlaidWebhooksNow). Generous
    // enough that a real person retrying a flaky bank never meets it.
    if (!(await rateLimitDurable(`plaid-update-token:${userId}`, UPDATE_TOKEN_LIMIT, UPDATE_TOKEN_WINDOW_MS))) {
      return { ok: false, error: 'Give it a minute and try again.' };
    }
    // Ownership is re-checked inside the provider (accessTokenFor is scoped to
    // {userId, itemId} and throws), so this is a fast, honest error rather than a gate.
    const linkToken = await new PlaidProvider().createUpdateLinkToken(userId, itemId);
    // Minting an update-mode token is a real event on a live connection — the link and
    // remove sides are both audited, and this one sits between them.
    await auditLog(userId, 'plaid.item.update_token', { itemId }).catch(() => {});
    return { ok: true, linkToken, sandbox: (process.env.PLAID_ENV ?? 'sandbox') !== 'production' };
  } catch {
    // No message: the provider's can name a Plaid item id, and every failure here —
    // foreign item, unknown item, decrypt failure, Plaid error — must look identical so
    // this cannot become an enumeration oracle. The caller supplies the wording, which
    // lets it name the bank the user actually tapped.
    return { ok: false };
  }
}

/**
 * Step 2: exchange the public token from Plaid Link, then pull accounts,
 * transactions, and liabilities. Reuses the sandbox-validated provider methods.
 *
 * NEVER call this with a public token from an UPDATE-mode Link session: Plaid documents
 * that the item's access token is unchanged and the exchange must not be repeated
 * (plaid.com/docs/link/update-mode, fetched 2026-07-24). The update flow calls
 * `syncPlaidNow` instead, which is how newly-shared accounts arrive.
 */
export async function linkPlaidAccount(
  publicToken: string,
  /**
   * `deepenHistory` — this session came from "get the full two years" (TASKS H.6), so a
   * connection that duplicates one the user already has is KEPT rather than handed back to
   * Plaid: it is the one carrying the 730-day window, which Plaid freezes at Item creation.
   * See `PlaidProvider.decideAndPersistItem` for why taking the caller's word for this is the
   * safe direction (a kept duplicate is disclosed, combinable and undoable; a wrong discard
   * destroys a live credential).
   */
  opts?: { deepenHistory?: boolean },
): Promise<LinkResult> {
  try {
    const userId = await requireUserId();
    if (isDemoUser(userId)) return { ok: false, error: DEMO_CONNECT_BLOCKED };
    if (!plaidConfigured()) return { ok: false, error: 'Bank linking isn’t configured yet.' };
    if (!publicToken) return { ok: false, error: 'Missing public token.' };
    // Scalar-validate before the flag can reach a branch (#279): a server-action argument is
    // attacker-controlled and TypeScript's types are erased at this boundary, so only the
    // literal `true` counts. Anything else — a truthy string, a missing field — is FALSE,
    // which is the ordinary front door with its redundancy check fully in force.
    const deepenHistory = opts?.deepenHistory === true;
    const provider = new PlaidProvider();
    // The EXCHANGE is the only step that gates link success: once it resolves, the
    // item is persisted (encrypted) and its accounts are synced. The follow-on
    // transaction + liability pulls are BEST-EFFORT — a depository-only institution
    // returns no liabilities (PRODUCTS_NOT_SUPPORTED, expected now that liabilities
    // is required_if_supported, not required), and the sandbox often lags on
    // transactions. Neither must turn a real, successful link into an error, nor
    // skip the cache revalidation that surfaces the just-linked accounts.
    const outcome = await provider.exchangePublicToken(userId, publicToken, { deepenHistory });
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
    // The SAME list every other sync path uses (critic P1-1). This was a third
    // hand-maintained set of four paths, and first link is the one moment a user goes
    // from ZERO detected scheduled projections to N — so `/spending-plan`, the page
    // whose guilt-free breakdown is summed from exactly those rows, was left stale by
    // the code path that first fills it, along with /forecast, /calendar, /cards,
    // /coach, /recurring and the rest.
    revalidateAfterSync();
    // The follow-on syncs above are user-wide, so on the refused path they refresh the
    // connection that was KEPT — which is what "it just refreshes" has to mean to be true.
    if (outcome.kind === 'already-connected') {
      return {
        ok: true,
        added,
        notice: alreadyConnectedFlash({
          bank: outcome.institutionName ?? 'that bank',
          matchedAccountCount: outcome.matchedAccountCount,
        }),
      };
    }
    if (outcome.kind === 'linked-for-history') {
      return {
        ok: true,
        added,
        notice: linkedForHistoryFlash({
          bank: outcome.institutionName ?? 'that bank',
          matchedAccountCount: outcome.matchedAccountCount,
          combinable: outcome.combinable,
        }),
      };
    }
    if (outcome.kind === 'linked-with-overlap') {
      return {
        ok: true,
        added,
        notice: linkedWithOverlapFlash({
          bank: outcome.institutionName ?? 'that bank',
          matchedAccountCount: outcome.matchedAccountCount,
          newAccountCount: outcome.newAccountCount,
        }),
      };
    }
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
  /**
   * Did this sync move ANYTHING the server render shows? (L.28.)
   *
   * `AutoSync` runs on every full page load and re-renders only when this is true, so
   * a mutation missing from this answer is a page that goes on painting a stale
   * figure. The predicate used to live in that client component and read `added` and
   * `statementsWritten` alone — every other thing a sync writes was invisible to it.
   * The owner's live syncs reported `added: 0, statementsWritten: 0` while L.26's
   * re-keying rewrote his detected scheduled projections from 0 rows to 8
   * ($684.31/month), so the very load that repaired his guilt-free breakdown
   * re-painted the stale $0.00 and only the NEXT load showed the money.
   *
   * It is computed HERE, not in the client, for two reasons: this is where every
   * count is in scope, and this is where a test can reach it — `auto-sync.tsx` is a
   * `'use client'` component with no test in the repo, so a side-effect added to the
   * sync below is now one `||` away from being seen instead of needing a matching
   * edit in a file nothing guards. REQUIRED, so no return path can omit it and
   * inherit the old silence by default.
   */
  changed: boolean;
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
    if (isDemoUser(userId)) return { ok: false, changed: false, error: DEMO_CONNECT_BLOCKED };
    if (!plaidConfigured()) return { ok: false, changed: false, error: 'Bank linking isn’t configured yet.' };
    // A server-action argument is attacker-controlled: TypeScript's `string` is
    // erased at the boundary, so a crafted POST can send any JSON. Unvalidated,
    // `itemId = {not:'x'}` reached the Prisma `where` verbatim, matched EVERY item,
    // passed the ownership gate, and turned "sync this one bank" into "sync all of
    // them" (critic P1-1, executed). Scalar-validate at the boundary, like #271.
    if (itemId !== undefined && (typeof itemId !== 'string' || itemId.trim() === '')) {
      return { ok: false, changed: false, error: 'That bank isn’t connected.' };
    }
    if (!(await rateLimitDurable(`plaid-sync:${userId}`, SYNC_LIMIT, SYNC_WINDOW_MS))) {
      return { ok: false, changed: false, error: 'Too many syncs — give it a minute and try again.' };
    }
    // Scoped count doubles as the ownership check for a per-connection sync: a
    // foreign itemId counts 0 and is refused, never silently syncing nothing.
    const items = await prisma.plaidItem.count({
      where: { userId, ...(itemId ? { itemId } : {}) },
    });
    if (items === 0) {
      return { ok: false, changed: false, error: itemId ? 'That bank isn’t connected.' : 'No Plaid banks are connected.' };
    }

    const provider = new PlaidProvider();
    // Accumulates across every half below. Each `= true` marks a write this sync made
    // to something a page renders; see PlaidSyncNowResult.changed for why it is summed
    // here rather than in the caller.
    let changed = false;
    // The account rows as they stand BEFORE any half runs. Counters cannot see the
    // biggest writer in the sync — `syncAccountsForItem` rewrites every balance and
    // creates new rows returning `void`, and `syncLiabilities` writes APR, due day,
    // cycle-close day and loan minimums while counting only statements — so the rows
    // are compared instead of the writers enumerated (critic P0-1; see
    // sync-change-digest.ts). Best-effort: a digest read must never fail a sync, and
    // failing to read it simply leaves the other signals to answer.
    let accountsBefore: string | null = null;
    try {
      accountsBefore = await accountShapeDigest(userId);
    } catch {
      /* the counters below still answer for everything they cover */
    }
    let added: number | undefined;
    let txError: string | undefined;
    try {
      const sync = await provider.syncTransactions(userId, { itemId });
      added = sync.added;
      // Not just `added`. A pending row turning posted (`modified`) or vanishing
      // (`removed`) rewrites the register and the balances it feeds while adding
      // nothing, and `derivedChanged` carries the transfer flags plus the recurring
      // series and scheduled projections recomputed at the tail of the ingest.
      if (sync.added > 0 || sync.modified > 0 || sync.removed > 0 || sync.derivedChanged) {
        changed = true;
      }
      // A per-item failure is ISOLATED inside the provider — audited, recorded on the
      // item, and stepped over so one bad bank can't cost the others their data. That
      // isolation used to end the story: the caller saw `added: 0` and no error, so the
      // UI told a user whose bank had just refused them "0 new transactions". Now the
      // count comes back, and a scoped sync (one bank, from its own Sync or from the
      // update flow) reports failure whenever THAT bank was the one that failed.
      if ((sync.itemsFailed ?? 0) > 0) {
        txError = 'the bank did not return transactions';
        await auditLog(userId, 'plaid.sync.transactions.failed', {
          ...(itemId ? { itemId } : {}),
          itemsFailed: sync.itemsFailed,
          isolated: true,
        }).catch(() => {});
      }
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
      if (liab.statementsWritten > 0) changed = true;
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
      // Deliberately NOT folded into `changed`: a webhook URL is plumbing, rendered on
      // no page, so registering one is not a reason to re-render anything.
      await provider.updateWebhooks(userId, { itemId });
    } catch {
      /* provider isolates + audits per-item failures; a total failure is non-fatal here */
    }

    // Best-effort institution-name backfill (owner-reported 2026-07-23: linked banks
    // read "Connected bank" with no name). Idempotent — only items still missing a name
    // are looked up, so a normal Sync tap labels Chase/Capital One the first time and
    // costs nothing thereafter. Cosmetic: never turns a successful data pull into an error.
    try {
      const inst = await provider.syncInstitutions(userId, { itemId });
      // The bank's name IS rendered — this backfill is what turns "Connected bank"
      // into "Chase" on /accounts — so the load that fills it in should show it.
      if (inst.updated > 0) changed = true;
    } catch {
      /* provider isolates + audits per-item failures; a total failure is non-fatal here */
    }

    // Best-effort investment-holdings refresh (TASKS 4.3). No-op (zero billed calls) for a
    // user with no investment account; isolated + non-fatal like the backfills above — a
    // holdings hiccup must never turn a successful transaction/statement sync into a red
    // error. The /investments revalidation below then surfaces any updated positions.
    try {
      const holdings = await provider.syncHoldings(userId, { itemId });
      // Positions written or sold off change /investments and the net-worth total.
      // `skipped` and `withheldNonUsd` are deliberately excluded: nothing was stored,
      // so there is nothing new to paint.
      if (holdings.upserted > 0 || holdings.removed > 0) changed = true;
    } catch {
      /* provider isolates + audits per-item failures; a total failure is non-fatal here */
    }

    // U.4: this month's balance point, after every half above has had its chance to
    // write balances. Idempotent within the month (and demo-fenced) inside the writer,
    // so calling it here as well as from the nightly cron costs one indexed read per
    // sync and means history accrues for a user whose deployment never runs the cron.
    // Best-effort like the backfills above: recording history must never turn a
    // successful data pull into a red error, and it changes nothing a page renders
    // this instant, so it is deliberately NOT folded into `changed`.
    try {
      await recordMonthlyBalanceSnapshot(userId);
    } catch {
      /* the sync itself succeeded; the next one re-attempts the month */
    }

    // Balances, new account rows, APRs, due days, cycle-close days and loan minimums —
    // everything the counters above are blind to. Read AFTER every half, including the
    // ones that threw: a half can write rows and then fail, and those rows are on the
    // page either way.
    if (accountsBefore !== null) {
      try {
        if ((await accountShapeDigest(userId)) !== accountsBefore) changed = true;
      } catch {
        /* leave `changed` to the other signals rather than guessing */
      }
    }

    // Never let a revalidation blip discard a `changed` that was truthfully earned:
    // this is the one unguarded statement after the writes, so an unguarded throw here
    // would land in the outer catch and return `changed: false` over a real write.
    try {
      revalidateAfterSync();
    } catch {
      /* cache marking is best-effort; the client re-render is driven by `changed` */
    }

    // Only a BOTH-halves failure is a failed sync; either half succeeding is real
    // progress the user should see rather than a red error.
    if (txError !== undefined && liabilitiesFailed) {
      return { ok: false, changed, error: 'Sync failed — please try again in a minute.' };
    }
    return {
      ok: true,
      changed,
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
    // `changed: false` here means "we cannot say", not "nothing was written" — an
    // earlier draft of this comment claimed the latter and a critic falsified it. Every
    // half of the sync is individually guarded, and so now are the digest read and the
    // revalidation that follow them, so the throws that can actually land here are the
    // pre-sync ones (auth, the item count) which run before any write. It is stated as
    // a limit rather than a guarantee because the accumulator is out of scope by the
    // time we get here, and a false `changed: true` is the cheaper of the two errors.
    return { ok: false, changed: false, error: 'Could not sync your banks — please try again in a minute.' };
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

/**
 * Ask Plaid who each connection banks with, for connections whose `institutionId` is not stored
 * yet (TASKS L.10). The identity ladder scopes every comparison to one institution and refuses
 * to fall back to the human bank NAME when only one side has been identified — so a connection
 * linked before that column existed can block a Combine offer until the ordinary sweep fills it
 * in. This is that sweep, on demand, from the card that explains the block.
 */
export async function refreshBankIdentity(): Promise<{ ok: boolean; updated?: number; error?: string }> {
  try {
    const userId = await requireUserId();
    if (isDemoUser(userId)) return { ok: false, error: DEMO_CONNECT_BLOCKED };
    if (!(await rateLimitDurable(`plaid-institutions:${userId}`, 6, 60_000))) {
      return { ok: false, error: 'Too many attempts — wait a minute and try again.' };
    }
    const result = await new PlaidProvider().syncInstitutions(userId);
    revalidatePath('/accounts');
    return { ok: true, updated: result.updated };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not reach your bank just now.' };
  }
}
