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
 *   PENDING (DECISIONS #22 tail): recurring re-detection + ScheduledTransaction
 *   refresh after ingest. Per-row normalize→rules→categorize→transfer IS wired;
 *   cross-account recurring/scheduled refresh reuses detect.ts and is the one
 *   documented step not yet called here (noted in the walkthrough, not hidden).
 *
 * Demo mode is entirely unaffected — the DataProvider seam keeps this dormant.
 */
import { type ISODate, isoDate } from '@/lib/dates';
import { decryptToken, encryptToken } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import { detectTransfers } from '@/lib/engine/categorize/transfers';
import { loadUserRules } from '@/server/rules';
import {
  type PlaidAccount,
  type PlaidCreditLiability,
  type PlaidTransaction,
  mapPlaidAccount,
  mapPlaidLiabilityToStatement,
  prepareIngestedTransaction,
} from './plaid-map';
import { DemoProvider } from './demo';
import type { DataProvider, FinanceSnapshot, SyncResult } from './types';

const PLAID_HOSTS: Record<string, string> = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
};

function plaidEnv() {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new Error('Plaid credentials missing — set PLAID_CLIENT_ID and PLAID_SECRET');
  }
  const host = PLAID_HOSTS[process.env.PLAID_ENV ?? 'sandbox'];
  return { clientId, secret, host };
}

async function plaidPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { clientId, secret, host } = plaidEnv();
  const response = await fetch(`${host}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, secret, ...body }),
  });
  if (!response.ok) {
    // never log request bodies — they can carry tokens
    throw new Error(`Plaid ${path} failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export class PlaidProvider implements DataProvider {
  today(): ISODate {
    // Real data uses the real clock — formatted as a calendar date once, here.
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return isoDate(`${y}-${m}-${d}`);
  }

  /** Step 1 of Link: create a link token for the client-side Plaid Link SDK. */
  async createLinkToken(userId: string): Promise<string> {
    const result = await plaidPost<{ link_token: string }>('/link/token/create', {
      user: { client_user_id: userId },
      client_name: 'Pulse Finance',
      products: ['transactions', 'liabilities'],
      country_codes: ['US'],
      language: 'en',
      webhook: process.env.PLAID_WEBHOOK_URL || undefined,
    });
    return result.link_token;
  }

  /** Step 2: exchange the public token; store it ENCRYPTED, then pull accounts. */
  async exchangePublicToken(userId: string, publicToken: string): Promise<void> {
    const result = await plaidPost<{ access_token: string; item_id: string }>(
      '/item/public_token/exchange',
      { public_token: publicToken },
    );
    await prisma.plaidItem.create({
      data: { userId, itemId: result.item_id, accessToken: encryptToken(result.access_token) },
    });
    await prisma.auditLog.create({
      data: { userId, action: 'plaid.item.link', meta: JSON.stringify({ itemId: result.item_id }) },
    });
    // Accounts must exist before transactions can be mapped to them.
    await this.syncAccountsForItem(userId, result.item_id);
  }

  /** /accounts/get → upsert Account rows (balances stored positive, type-mapped). */
  async syncAccountsForItem(userId: string, itemId: string): Promise<void> {
    const token = await this.accessTokenFor(userId, itemId);
    const { accounts } = await plaidPost<{ accounts: PlaidAccount[] }>('/accounts/get', {
      access_token: token,
    });
    for (const a of accounts) {
      const m = mapPlaidAccount(a);
      const existing = await prisma.account.findFirst({
        where: { userId, provider: 'plaid', providerRef: m.providerRef },
        select: { id: true },
      });
      const data = {
        name: m.name,
        type: m.type,
        mask: m.mask,
        currentBalanceCents: m.currentBalanceCents,
        availableBalanceCents: m.availableBalanceCents,
        creditLimitCents: m.creditLimitCents,
      };
      if (existing) {
        await prisma.account.update({ where: { id: existing.id }, data });
      } else {
        await prisma.account.create({
          data: { userId, provider: 'plaid', providerRef: m.providerRef, ...data },
        });
      }
    }
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
    let added = 0;
    let modified = 0;
    let removed = 0;
    let lastCursor: string | null = null;

    for (const item of items) {
      const token = decryptToken(item.accessToken);
      const accounts = await prisma.account.findMany({
        where: { userId, provider: 'plaid' },
        select: { id: true, providerRef: true },
      });
      const idByPlaidId = new Map(accounts.map((a) => [a.providerRef ?? '', a.id]));

      let cursor = item.cursor ?? undefined;
      let hasMore = true;
      while (hasMore) {
        const page = await plaidPost<{
          added: PlaidTransaction[];
          modified: PlaidTransaction[];
          removed: { transaction_id: string }[];
          next_cursor: string;
          has_more: boolean;
        }>('/transactions/sync', { access_token: token, cursor });

        for (const txn of [...page.added, ...page.modified]) {
          const accountId = idByPlaidId.get(txn.account_id);
          if (!accountId) continue; // account not yet synced — skip, next sweep catches it
          const row = prepareIngestedTransaction(txn, accountId, rules);
          const merchant = await prisma.merchant.upsert({
            where: { canonical: row.merchantCanonical },
            create: { canonical: row.merchantCanonical, defaultCategoryId: row.categoryId },
            update: {},
          });
          const existing = await prisma.transaction.findFirst({
            where: { providerRef: row.providerRef, account: { userId } },
            select: { id: true },
          });
          const data = {
            date: row.date,
            amountCents: row.amountCents,
            rawDescriptor: row.rawDescriptor,
            merchantId: merchant.id,
            categoryId: row.categoryId,
            confidenceBps: row.confidenceBps,
            status: row.status,
            needsReview: row.needsReview,
            isTransfer: row.isTransfer,
          };
          if (existing) {
            await prisma.transaction.update({ where: { id: existing.id }, data });
            modified++;
          } else {
            await prisma.transaction.create({ data: { accountId, providerRef: row.providerRef, ...data } });
            added++;
          }
        }

        for (const r of page.removed) {
          const res = await prisma.transaction.deleteMany({
            where: { providerRef: r.transaction_id, account: { userId } },
          });
          removed += res.count;
        }

        cursor = page.next_cursor;
        hasMore = page.has_more;
      }

      await prisma.plaidItem.update({ where: { id: item.id }, data: { cursor } });
      lastCursor = cursor ?? null;
    }

    await this.refreshTransferFlags(userId);
    return { added, modified, removed, nextCursor: lastCursor };
  }

  /** /liabilities/get → upsert a Statement per credit card with a generated cycle. */
  async syncLiabilities(userId: string): Promise<void> {
    const items = await prisma.plaidItem.findMany({ where: { userId } });
    const accounts = await prisma.account.findMany({
      where: { userId, provider: 'plaid' },
      select: { id: true, providerRef: true },
    });
    const idByPlaidId = new Map(accounts.map((a) => [a.providerRef ?? '', a.id]));

    for (const item of items) {
      const token = decryptToken(item.accessToken);
      const { liabilities } = await plaidPost<{ liabilities: { credit?: PlaidCreditLiability[] } }>(
        '/liabilities/get',
        { access_token: token },
      );
      for (const credit of liabilities.credit ?? []) {
        const accountId = idByPlaidId.get(credit.account_id);
        if (!accountId) continue;
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
    }
  }

  /** Re-derive isTransfer across the user's full set (descriptor + pair matching). */
  private async refreshTransferFlags(userId: string): Promise<void> {
    const txns = await prisma.transaction.findMany({
      where: { account: { userId }, isSplitParent: false },
      select: { id: true, accountId: true, date: true, amountCents: true, rawDescriptor: true },
    });
    const transferIds = detectTransfers(txns);
    if (transferIds.size > 0) {
      await prisma.transaction.updateMany({
        where: { id: { in: [...transferIds] } },
        data: { isTransfer: true },
      });
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
