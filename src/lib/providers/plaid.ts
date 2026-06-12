/**
 * PlaidProvider — DORMANT, and honestly labeled: a PARTIAL SCAFFOLD, not an
 * implementation (adversarial review cycle 1, finding C3).
 *
 * Implemented (untested against a live sandbox):
 *   - POST /link/token/create → Link token for the client SDK
 *   - POST /item/public_token/exchange → access token, AES-256-GCM encrypted
 *   - POST /item/remove → part of the data-deletion path (docs/PRIVACY.md)
 *
 * NOT IMPLEMENTED (ROADMAP #1 — calling these throws rather than silently
 * doing nothing):
 *   - /transactions/sync persistence: mapping Plaid rows into Transaction
 *     records (incl. the outflow-sign flip), per-item cursor storage
 *   - /liabilities/get → Statement mapping
 *   - rules/transfer/recurring processing on ingest
 *
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

  async syncTransactions(): Promise<SyncResult> {
    // Refusing to pretend: fetching without persisting would report a
    // "successful" sync that stores nothing (cycle-1 finding C3). Fails loudly
    // until the ingestion trunk lands (ROADMAP #1).
    throw new Error(
      'PlaidProvider.syncTransactions is not implemented: transaction persistence, ' +
        'per-item cursors, and liabilities→Statement mapping are ROADMAP #1. ' +
        'See docs/PLAID_WALKTHROUGH.md.',
    );
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
  const result = await prisma.account.updateMany({
    where: { userId, provider: 'plaid' },
    data: { providerRef: `${itemId}::${encrypted}` },
  });
  if (result.count === 0) {
    // Never silently drop a token (cycle-1 C3): with no plaid account rows yet
    // there is nowhere to store it — fail the exchange instead of "succeeding".
    throw new Error(
      'No plaid accounts exist for this user yet — account rows must be created before token storage (ROADMAP #1).',
    );
  }
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
