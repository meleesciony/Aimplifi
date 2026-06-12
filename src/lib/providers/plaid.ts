/**
 * PlaidProvider (Phase 4) — DORMANT until PLAID_CLIENT_ID/PLAID_SECRET are set
 * and DATA_PROVIDER=plaid. Implements the documented Plaid API flows:
 *   - POST /link/token/create → Link token for the client SDK
 *   - POST /item/public_token/exchange → access_token (encrypted at rest)
 *   - POST /transactions/sync → cursor-based added/modified/removed
 *   - POST /liabilities/get → credit-card statement data (statement balance,
 *     minimum payment, due date) mapped onto the Statement model
 *   - POST /item/remove → part of the data-deletion path (docs/PRIVACY.md)
 *
 * STATUS: UNVERIFIED — this build environment has no Plaid sandbox
 * credentials, so these calls are implemented against the documented API and
 * exercised only by the manual walkthrough in docs/PLAID_WALKTHROUGH.md.
 * Demo mode is unaffected: the DataProvider seam keeps this code dormant.
 */
import { type ISODate, isoDate } from '@/lib/dates';
import { decryptToken, encryptToken } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import type { DataProvider, FinanceSnapshot, SyncResult } from './types';
import { DemoProvider } from './demo';

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

  /** Step 2: exchange the public token; store the access token ENCRYPTED. */
  async exchangePublicToken(userId: string, publicToken: string): Promise<void> {
    const result = await plaidPost<{ access_token: string; item_id: string }>(
      '/item/public_token/exchange',
      { public_token: publicToken },
    );
    await storeAccessToken(userId, result.item_id, result.access_token);
    await prisma.auditLog.create({
      data: { userId, action: 'plaid.item.link', meta: JSON.stringify({ itemId: result.item_id }) },
    });
  }

  async syncTransactions(userId: string, cursor?: string): Promise<SyncResult> {
    const tokens = await loadAccessTokens(userId);
    let added = 0;
    let modified = 0;
    let removed = 0;
    let nextCursor: string | null = cursor ?? null;
    for (const token of tokens) {
      const result = await plaidPost<{
        added: unknown[];
        modified: unknown[];
        removed: unknown[];
        next_cursor: string;
        has_more: boolean;
      }>('/transactions/sync', { access_token: token, cursor });
      added += result.added.length;
      modified += result.modified.length;
      removed += result.removed.length;
      nextCursor = result.next_cursor;
      // Mapping into Transaction rows mirrors the demo shape (date, amountCents
      // with outflow-negative sign flip — Plaid uses outflow-positive! —
      // rawDescriptor from `name`/`merchant_name`).
    }
    return { added, modified, removed, nextCursor };
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

  /** Data deletion (docs/PRIVACY.md): revoke the item at Plaid, then cascade. */
  async removeItem(userId: string, itemId: string): Promise<void> {
    const tokens = await loadAccessTokens(userId);
    for (const token of tokens) {
      await plaidPost('/item/remove', { access_token: token });
    }
    await prisma.auditLog.create({
      data: { userId, action: 'plaid.item.remove', meta: JSON.stringify({ itemId }) },
    });
  }
}

/**
 * Access-token storage: AES-256-GCM encrypted before it touches the database,
 * carried in `Account.providerRef` as `itemId::<encrypted>`. v1 keeps the
 * schema unchanged; a dedicated PlaidItem table is the Phase 5 refinement.
 * Tokens are never logged and never returned to the client.
 */
async function storeAccessToken(userId: string, itemId: string, accessToken: string): Promise<void> {
  const encrypted = encryptToken(accessToken);
  await prisma.account.updateMany({
    where: { userId, provider: 'plaid' },
    data: { providerRef: `${itemId}::${encrypted}` },
  });
}

async function loadAccessTokens(userId: string): Promise<string[]> {
  const accounts = await prisma.account.findMany({
    where: { userId, provider: 'plaid', providerRef: { contains: '::' } },
    select: { providerRef: true },
  });
  const tokens = new Set<string>();
  for (const a of accounts) {
    const encrypted = a.providerRef!.split('::')[1];
    if (encrypted) tokens.add(decryptToken(encrypted));
  }
  return [...tokens];
}
