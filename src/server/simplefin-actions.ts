'use server';

/**
 * SimpleFIN connect/sync/disconnect actions (ROADMAP: cheaper Plaid alternative).
 * DORMANT until a user pastes a SimpleFIN setup token; the access URL (which
 * carries read-only credentials) is encrypted at rest, so connecting requires
 * DATA_ENCRYPTION_KEY — absent, the action fails gracefully rather than storing a
 * credential in plaintext. Ownership-scoped + audit-logged.
 */
import { businessToday } from '@/lib/business-today';
import { encryptToken } from '@/lib/crypto';
import { DEMO_CONNECT_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { prisma } from '@/lib/db';
import { auditLog, requireUserId } from '@/server/authz';
import { claimAccessUrl, syncFromSimplefin } from '@/lib/providers/simplefin';
import type { SyncResult } from '@/lib/providers/types';
import { accountShapeDigest } from '@/server/sync-change-digest';
import { revalidateAfterSync } from '@/server/sync-revalidate';

export interface SimplefinResult {
  ok: boolean;
  /**
   * Did this call move anything the server render shows? Same contract, same reason as
   * `PlaidSyncNowResult.changed` (L.28) — `AutoSync` re-renders on it, and a sync that
   * ingests no transaction can still rewrite the recurring series and the scheduled
   * projections the spending plan, forecast and calendar are summed from. Required so
   * no return path can quietly omit it.
   */
  changed: boolean;
  error?: string;
  added?: number;
  /** Brokerage-holdings reconciliation from this sync, when any ran (DECISIONS #124).
   *  withheldNonUsd = positions withheld as non-USD (no FX — DECISIONS #156). */
  holdings?: { upserted: number; removed: number; skipped: number; withheldNonUsd: number };
  message?: string;
}

/**
 * Did this sync write anything a page renders? Ingested or re-shaped transactions
 * (a pending row posting is `modified`, one vanishing is `removed` — both rewrite the
 * register while adding nothing), holdings actually stored or sold off, or the derived
 * transfer flags / recurring series / scheduled projections recomputed at the tail.
 */
function syncChangedSomething(r: SyncResult): boolean {
  return (
    r.added > 0 ||
    r.modified > 0 ||
    r.removed > 0 ||
    r.derivedChanged ||
    (r.holdings?.upserted ?? 0) > 0 ||
    (r.holdings?.removed ?? 0) > 0
  );
}

export async function connectSimplefin(setupToken: string): Promise<SimplefinResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, changed: false, error: DEMO_CONNECT_BLOCKED };
  if (!setupToken.trim()) return { ok: false, changed: false, error: 'Paste your SimpleFIN setup token.' };
  if (!process.env.DATA_ENCRYPTION_KEY) {
    return { ok: false, changed: false, error: 'Connecting a bank needs DATA_ENCRYPTION_KEY set on the server.' };
  }

  let accessUrl: string;
  try {
    accessUrl = await claimAccessUrl(setupToken);
  } catch (e) {
    return { ok: false, changed: false, error: e instanceof Error ? e.message : 'Could not claim that setup token.' };
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
    revalidateAfterSync();
    return { ok: true, changed: syncChangedSomething(r), added: r.added, holdings: r.holdings };
  } catch {
    // The link is saved; the first sync can be retried from the accounts page. Use a
    // FIXED message — a provider/network error can embed the credential-bearing URL,
    // so never reflect it to the client (Hostile Critic SEC-SF-4).
    revalidateAfterSync();
    // The connection row itself was written, and /accounts renders it — so this is a
    // change even though the ingest that would have filled it never landed.
    return {
      ok: true,
      changed: true,
      added: 0,
      error: 'Connected, but the first sync failed — try "Sync now" from Accounts.',
    };
  }
}

export async function syncSimplefinNow(): Promise<SimplefinResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, changed: false, error: DEMO_CONNECT_BLOCKED };
  // The account rows before the sync. SimpleFIN rewrites every balance on each run and
  // reports no counter for it, exactly as the Plaid path does (critic P0-1) — and an
  // INVESTMENT or LOAN account has no transactions at all, so its balance is the only
  // thing that ever moves. Best-effort: never fail a sync over a change signal.
  let accountsBefore: string | null = null;
  try {
    accountsBefore = await accountShapeDigest(userId);
  } catch {
    /* the result's own counters still answer for everything they cover */
  }
  try {
    const r = await syncFromSimplefin(userId, businessToday(userId));
    let changed = syncChangedSomething(r);
    if (!changed && accountsBefore !== null) {
      try {
        changed = (await accountShapeDigest(userId)) !== accountsBefore;
      } catch {
        /* leave it to the counters rather than guessing */
      }
    }
    revalidateAfterSync();
    return { ok: true, changed, added: r.added, holdings: r.holdings };
  } catch {
    // Fixed message — provider/network errors can embed the credential-bearing URL.
    return { ok: false, changed: false, error: 'Sync failed — please try again in a minute.' };
  }
}

export async function disconnectSimplefin(): Promise<SimplefinResult> {
  const userId = await requireUserId();
  await prisma.simpleFinConnection.deleteMany({ where: { userId } });
  await auditLog(userId, 'simplefin.disconnect', {});
  revalidateAfterSync();
  return {
    ok: true,
    changed: true,
    message:
      'Bank disconnected. Your already-synced accounts and history are kept (they just won’t update) — delete any you don’t want counted from the lists above.',
  };
}
