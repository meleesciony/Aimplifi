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
import type { ISODate } from '@/lib/dates';
import { businessToday } from '@/lib/business-today';
import { decryptToken, encryptToken } from '@/lib/crypto';
import { isUniqueViolation, prisma, serializableTx } from '@/lib/db';
import { refreshTransferFlags } from '@/lib/providers/transfer-refresh';
import { safeSyncErrorReason } from '@/lib/providers/sync-status';
import { loadUserRules } from '@/server/rules';
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
import { assistUnsureRows } from '@/server/categorize-assist';
import { suggestCategoryViaLLM } from '@/server/llm-categorize';
import { DemoProvider } from './demo';
import type { DataProvider, FinanceSnapshot, SyncResult } from './types';

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
 * `liabilities` in required_if_supported (not `products`) is what keeps depository-
 * only banks linkable. `redirectUri` is registered ONLY when set: an OAuth bank
 * (Chase/BofA) redirects the browser to it to hand the user back; when unset the
 * key is omitted entirely so non-OAuth linking works with zero extra config (Plaid
 * rejects a redirect_uri that isn't an exact match for a dashboard-registered URI).
 */
export function linkTokenParams(userId: string, redirectUri?: string): Record<string, unknown> {
  return {
    user: { client_user_id: userId },
    client_name: 'Aimplifi',
    products: ['transactions'],
    required_if_supported_products: ['liabilities'],
    country_codes: ['US'],
    language: 'en',
    webhook: process.env.PLAID_WEBHOOK_URL || undefined,
    redirect_uri: redirectUri || undefined,
  };
}

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

  /** Step 2: exchange the public token; store it ENCRYPTED, then pull accounts. */
  async exchangePublicToken(userId: string, publicToken: string): Promise<void> {
    const result = await plaidPost<{ access_token: string; item_id: string }>(
      '/item/public_token/exchange',
      { public_token: publicToken },
    );
    // Upsert by itemId so a link that failed AFTER the token was stored (e.g. the
    // initial account sync threw) stays retryable — re-linking refreshes the token
    // instead of hitting the itemId unique constraint and locking the user out.
    await prisma.plaidItem.upsert({
      where: { itemId: result.item_id },
      create: { userId, itemId: result.item_id, accessToken: encryptToken(result.access_token) },
      update: { accessToken: encryptToken(result.access_token) },
    });
    await prisma.auditLog.create({
      data: { userId, action: 'plaid.item.link', meta: JSON.stringify({ itemId: result.item_id }) },
    });
    // Accounts must exist before transactions can be mapped to them.
    await this.syncAccountsForItem(userId, result.item_id);
  }

  /** /accounts/get → upsert Account rows (type-mapped; current balance signed). */
  async syncAccountsForItem(userId: string, itemId: string): Promise<void> {
    const token = await this.accessTokenFor(userId, itemId);
    const { accounts } = await plaidPost<{ accounts: PlaidAccount[] }>('/accounts/get', {
      access_token: token,
    });
    await this.upsertPlaidAccounts(userId, accounts);
  }

  /**
   * Upsert Plaid accounts (from /accounts/get OR the /transactions/sync `accounts`
   * array). Per-account guarded: an account Plaid returns with a type we can't map
   * (e.g. the documented `other`) is skipped + audited rather than aborting the
   * whole item link/sync — a single odd account must never block every other one.
   */
  private async upsertPlaidAccounts(userId: string, accounts: readonly PlaidAccount[]): Promise<void> {
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
  async syncTransactions(userId: string): Promise<SyncResult> {
    const items = await prisma.plaidItem.findMany({ where: { userId } });
    const rules = await loadUserRules(userId);
    const today = this.today(userId); // stamp per-item sync success/failure (Gap 1 §4)
    let added = 0;
    let modified = 0;
    let removed = 0;
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
            await this.upsertPlaidAccounts(userId, page.accounts);
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
            prepareIngestedTransaction(p.txn, p.accountId, rules),
          );
          const assistedRows = await assistUnsureRows(preparedRows, suggestCategoryViaLLM);

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
                        await tx.correction.updateMany({
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
                      await tx.correction.updateMany({
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
                      await tx.correction.updateMany({
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
                    // Corrections follow the transaction across the id churn (audit = state).
                    await tx.correction.updateMany({
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
                  await prisma.transaction.create({ data: { accountId, providerRef: row.providerRef, ...data } });
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

    return { added, modified, removed, nextCursor: lastCursor };
  }

  /**
   * /liabilities/get → upsert a Statement per credit card with a generated cycle, AND
   * populate each mortgage/student LOAN account's rate + fixed monthly payment + due day
   * (#134). Without the loan branch a linked mortgage/student loan carries only a balance:
   * its APR stays 0 (the debt-payoff planner mis-computes) and its payment/due-date never
   * surface on the calendar or reminders.
   */
  async syncLiabilities(userId: string): Promise<void> {
    const items = await prisma.plaidItem.findMany({ where: { userId } });
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
          const stmt = mapPlaidLiabilityToStatement(credit, accountId);
          if (!stmt) continue; // no generated statement → cash-needed estimate path
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
        // must abort liability sync for the user's OTHER items (nor fail a link). The
        // estimate path covers any card left without a statement. Audit + continue.
        await prisma.auditLog
          .create({
            data: {
              userId,
              action: 'plaid.liabilities.failed',
              meta: JSON.stringify({ itemId: item.itemId, error: e instanceof Error ? e.message : String(e) }),
            },
          })
          .catch(() => {});
      }
    }
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

  async getFinanceSnapshot(userId: string): Promise<FinanceSnapshot> {
    // After sync, the DB is the source of truth — identical read path to demo.
    return new DemoProvider().getFinanceSnapshot(userId);
  }

  /** Decrypt the access token for one item (ownership-scoped). */
  private async accessTokenFor(userId: string, itemId: string): Promise<string> {
    const item = await prisma.plaidItem.findFirst({ where: { userId, itemId } });
    if (!item) throw new Error(`No linked Plaid item ${itemId} for this user`);
    return decryptToken(item.accessToken);
  }

  /** Data deletion (docs/PRIVACY.md): revoke each item at Plaid, then cascade. */
  async removeItem(userId: string, itemId: string): Promise<void> {
    const items = await prisma.plaidItem.findMany({ where: { userId, itemId } });
    for (const item of items) {
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
