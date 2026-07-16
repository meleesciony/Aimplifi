'use server';

/**
 * SimpleFIN connect/sync/disconnect actions (ROADMAP: cheaper Plaid alternative).
 * DORMANT until a user pastes a SimpleFIN setup token; the access URL (which
 * carries read-only credentials) is encrypted at rest, so connecting requires
 * DATA_ENCRYPTION_KEY — absent, the action fails gracefully rather than storing a
 * credential in plaintext. Ownership-scoped + audit-logged.
 */
import { revalidatePath } from 'next/cache';
import { businessToday } from '@/lib/business-today';
import { encryptToken } from '@/lib/crypto';
import { DEMO_CONNECT_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { prisma } from '@/lib/db';
import { auditLog, requireUserId } from '@/server/authz';
import { claimAccessUrl, syncFromSimplefin } from '@/lib/providers/simplefin';

export interface SimplefinResult {
  ok: boolean;
  error?: string;
  added?: number;
  /** Brokerage-holdings reconciliation from this sync, when any ran (DECISIONS #124).
   *  withheldNonUsd = positions withheld as non-USD (no FX — DECISIONS #156). */
  holdings?: { upserted: number; removed: number; skipped: number; withheldNonUsd: number };
  message?: string;
}

function revalidateAll() {
  for (const p of ['/accounts', '/dashboard', '/transactions', '/coach', '/calendar', '/cards', '/investments']) {
    revalidatePath(p);
  }
}

export async function connectSimplefin(setupToken: string): Promise<SimplefinResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_CONNECT_BLOCKED };
  if (!setupToken.trim()) return { ok: false, error: 'Paste your SimpleFIN setup token.' };
  if (!process.env.DATA_ENCRYPTION_KEY) {
    return { ok: false, error: 'Connecting a bank needs DATA_ENCRYPTION_KEY set on the server.' };
  }

  let accessUrl: string;
  try {
    accessUrl = await claimAccessUrl(setupToken);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not claim that setup token.' };
  }

  // The token is single-use; store the durable access URL encrypted.
  const ciphertext = encryptToken(accessUrl);
  await prisma.simpleFinConnection.upsert({
    where: { userId },
    create: { userId, accessUrl: ciphertext },
    update: { accessUrl: ciphertext, lastSyncedAt: null },
  });
  await auditLog(userId, 'simplefin.connect', {});

  try {
    const r = await syncFromSimplefin(userId, businessToday(userId));
    revalidateAll();
    return { ok: true, added: r.added, holdings: r.holdings };
  } catch {
    // The link is saved; the first sync can be retried from the accounts page. Use a
    // FIXED message — a provider/network error can embed the credential-bearing URL,
    // so never reflect it to the client (Hostile Critic SEC-SF-4).
    revalidateAll();
    return { ok: true, added: 0, error: 'Connected, but the first sync failed — try "Sync now" from Accounts.' };
  }
}

export async function syncSimplefinNow(): Promise<SimplefinResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_CONNECT_BLOCKED };
  try {
    const r = await syncFromSimplefin(userId, businessToday(userId));
    revalidateAll();
    return { ok: true, added: r.added, holdings: r.holdings };
  } catch {
    // Fixed message — provider/network errors can embed the credential-bearing URL.
    return { ok: false, error: 'Sync failed — please try again in a minute.' };
  }
}

export async function disconnectSimplefin(): Promise<SimplefinResult> {
  const userId = await requireUserId();
  await prisma.simpleFinConnection.deleteMany({ where: { userId } });
  await auditLog(userId, 'simplefin.disconnect', {});
  revalidateAll();
  return {
    ok: true,
    message:
      'Bank disconnected. Your already-synced accounts and history are kept (they just won’t update) — delete any you don’t want counted from the lists above.',
  };
}
