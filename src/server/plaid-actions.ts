'use server';

/**
 * Plaid Link server actions (DECISIONS #41) — the front door to the already-
 * validated PlaidProvider ingest (sandbox-proven, ROADMAP #1a). Used directly
 * (not via the DataProvider seam) so linking works regardless of DATA_PROVIDER.
 * Both degrade gracefully when Plaid isn't configured (no keys → {ok:false}),
 * preserving the zero-credential demo.
 */
import { revalidatePath } from 'next/cache';
import { PlaidProvider } from '@/lib/providers/plaid';
import { requireUserId } from '@/server/authz';

export interface LinkTokenResult {
  ok: boolean;
  linkToken?: string;
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
  const userId = await requireUserId();
  if (!plaidConfigured()) {
    return { ok: false, error: 'Bank linking isn’t configured yet (Plaid keys not set).' };
  }
  try {
    const linkToken = await new PlaidProvider().createLinkToken(userId);
    return { ok: true, linkToken };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not start bank linking.' };
  }
}

/**
 * Step 2: exchange the public token from Plaid Link, then pull accounts,
 * transactions, and liabilities. Reuses the sandbox-validated provider methods.
 */
export async function linkPlaidAccount(publicToken: string): Promise<LinkResult> {
  const userId = await requireUserId();
  if (!plaidConfigured()) return { ok: false, error: 'Bank linking isn’t configured yet.' };
  if (!publicToken) return { ok: false, error: 'Missing public token.' };
  try {
    const provider = new PlaidProvider();
    await provider.exchangePublicToken(userId, publicToken); // stores encrypted item + syncs accounts
    const sync = await provider.syncTransactions(userId);
    await provider.syncLiabilities(userId);
    revalidatePath('/accounts');
    revalidatePath('/transactions');
    revalidatePath('/dashboard');
    return { ok: true, added: sync.added };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not link your accounts.' };
  }
}
