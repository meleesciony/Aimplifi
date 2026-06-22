/**
 * SimpleFIN sync (ROADMAP: cheaper Plaid alternative). DORMANT by default — runs
 * only after a user connects a SimpleFIN setup token. Like Plaid Link
 * (DECISIONS #41), it writes provider='simplefin' Account/Transaction rows
 * DIRECTLY into the local DB (not through the DataProvider seam), so it works in
 * demo/local-first mode and flows into every engine automatically.
 *
 *   TESTED (pure): all SimpleFIN→Pulse mapping in simplefin-map.ts.
 *   TESTED (mocked fetch): claimAccessUrl + syncFromSimplefin orchestration.
 *   UNVERIFIED: the live network calls — implemented from the SimpleFIN protocol
 *   as of the Jan-2026 cutoff; confirm field shapes vs the current spec before
 *   trusting (docs/SIMPLEFIN_WALKTHROUGH.md). Real code, never run against a live
 *   SimpleFIN server here.
 */
import { type ISODate, addDays, isoDate, toEpochDays } from '@/lib/dates';
import { decryptToken } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import { detectTransfers } from '@/lib/engine/categorize/transfers';
import { assistUnsureRows } from '@/server/categorize-assist';
import { ensureCategories } from '@/server/ensure-categories';
import { suggestCategoryViaLLM } from '@/server/llm-categorize';
import { loadUserRules } from '@/server/rules';
import { refreshRecurringForUser } from '@/server/recurring';
import {
  type IngestedSfTransaction,
  type SimplefinAccount,
  mapSimplefinAccount,
  prepareSimplefinTransaction,
} from './simplefin-map';
import type { SyncResult } from './types';

export interface SimplefinAccountsResponse {
  errors?: string[];
  accounts?: SimplefinAccount[];
}

/**
 * SSRF guard: the claim/access URLs come from a user-pasted token, so refuse
 * anything that isn't a public https endpoint — no http, no loopback/private/
 * link-local/ULA host (IPv4 AND IPv6), no cloud-metadata target. Hostname-based
 * (won't stop DNS-rebinding — noted), and ENFORCED ON EVERY REDIRECT HOP by
 * safeFetch below. Returns the parsed URL.
 */
export function assertHttpsPublic(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('That does not look like a valid SimpleFIN URL.');
  }
  if (u.protocol !== 'https:') throw new Error('SimpleFIN URLs must use https.');
  // URL keeps IPv6 hosts bracketed ("[::1]") — strip so equality/ranges match.
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isV6 = host.includes(':');
  const blocked =
    host === 'localhost' ||
    host.endsWith('.local') ||
    // IPv4 loopback / private / link-local / unspecified
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^0\./.test(host) ||
    // IPv6 loopback / unspecified / IPv4-mapped (::ffff:…) / ULA fc00::/7 / link-local fe80::/10
    (isV6 &&
      (host.startsWith('::') || // ::1, ::, ::ffff:127.0.0.1 (and Node's ::ffff:7f00:1 form)
        /^f[cd][0-9a-f]{2}:/.test(host) ||
        /^fe[89ab][0-9a-f]:/.test(host)));
  if (blocked) throw new Error('That SimpleFIN host is not allowed.');
  return u;
}

/**
 * fetch with SSRF-safe redirect handling: validate EVERY hop with assertHttpsPublic
 * (the default redirect:'follow' would otherwise let a 30x reach an internal host,
 * bypassing the guard), bounded to a few redirects, and DROP the Authorization
 * header when a redirect crosses to a different host so read-only creds never leak.
 */
async function safeFetch(
  url: string,
  init: { method: string; headers?: Record<string, string> },
  maxRedirects = 3,
): Promise<Response> {
  let current = url;
  const headers = { ...(init.headers ?? {}) };
  const originHost = new URL(url).host;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    assertHttpsPublic(current);
    const res = await fetch(current, { method: init.method, headers, redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) return res;
    const loc = res.headers.get('location');
    if (!loc) throw new Error('SimpleFIN returned a redirect without a location.');
    const next = new URL(loc, current);
    if (next.host !== originHost && headers.Authorization) {
      delete headers.Authorization; // never carry credentials to a different host
    }
    current = next.toString();
  }
  throw new Error('SimpleFIN: too many redirects.');
}

/** Split the basic-auth creds out of a SimpleFIN access URL into a header
 *  (Node's fetch ignores URL userinfo), returning the credential-free base. */
function authFor(accessUrl: string): { base: string; headers: Record<string, string> } {
  const u = new URL(accessUrl);
  const headers: Record<string, string> = {};
  if (u.username || u.password) {
    const basic = Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64');
    headers.Authorization = `Basic ${basic}`;
    u.username = '';
    u.password = '';
  }
  return { base: u.toString().replace(/\/$/, ''), headers };
}

/**
 * Exchange a one-time SimpleFIN setup token for a permanent access URL. The setup
 * token is base64 of a claim URL; POSTing to it returns the access URL (which
 * carries the read-only credentials). Network — never throws sensitive data.
 */
export async function claimAccessUrl(setupToken: string): Promise<string> {
  let claimUrl: string;
  try {
    claimUrl = Buffer.from(setupToken.trim(), 'base64').toString('utf8').trim();
  } catch {
    throw new Error('That does not look like a SimpleFIN setup token.');
  }
  assertHttpsPublic(claimUrl); // SSRF guard on the user-derived claim URL (re-checked per hop)
  const res = await safeFetch(claimUrl, { method: 'POST', headers: { 'Content-Length': '0' } });
  if (!res.ok) throw new Error(`SimpleFIN claim failed (${res.status}).`);
  const accessUrl = (await res.text()).trim();
  assertHttpsPublic(accessUrl); // and on the returned access URL before we ever fetch it
  return accessUrl;
}

export async function fetchSimplefinAccounts(
  accessUrl: string,
  startDate?: ISODate,
): Promise<SimplefinAccountsResponse> {
  assertHttpsPublic(accessUrl); // SSRF guard before every fetch (URL came from storage/user)
  const { base, headers } = authFor(accessUrl);
  const url = new URL(`${base}/accounts`);
  if (startDate) url.searchParams.set('start-date', String(toEpochDays(startDate) * 86400));
  const res = await safeFetch(url.toString(), { method: 'GET', headers });
  if (!res.ok) throw new Error(`SimpleFIN /accounts failed (${res.status}).`);
  return res.json() as Promise<SimplefinAccountsResponse>;
}

/**
 * Pull accounts + transactions for a connected user and upsert them (idempotent
 * by providerRef). Runs the shared ingest pipeline per row, then re-detects
 * recurring series. Best-effort recurring refresh — never fails the sync over it.
 */
export async function syncFromSimplefin(userId: string, today: ISODate): Promise<SyncResult> {
  const conn = await prisma.simpleFinConnection.findUnique({ where: { userId } });
  if (!conn) return { added: 0, modified: 0, removed: 0, nextCursor: null };

  await ensureCategories(); // FK target for every txn.categoryId the categorizer emits (#63)
  const accessUrl = decryptToken(conn.accessUrl);
  const rules = await loadUserRules(userId);
  // Incremental syncs overlap a few days before the last sync so late-posting
  // transactions aren't missed; the FIRST sync pulls ~90 days of history so the
  // register/spending/recurring views aren't empty (SimpleFIN returns no
  // transactions without a start-date — real-bank sync, DECISIONS #61).
  const startDate = conn.lastSyncedAt ? addDays(isoDate(conn.lastSyncedAt), -5) : addDays(today, -90);
  const data = await fetchSimplefinAccounts(accessUrl, startDate);

  let added = 0;
  let modified = 0;
  // Pass 1: upsert accounts + balances, and PREPARE spending-account rows.
  const prepared: IngestedSfTransaction[] = [];
  for (const acct of data.accounts ?? []) {
    const mapped = mapSimplefinAccount(acct);
    const existingAcct = await prisma.account.findFirst({
      where: { userId, provider: 'simplefin', providerRef: mapped.providerRef },
      select: { id: true },
    });
    const accountId = existingAcct
      ? existingAcct.id
      : (
          await prisma.account.create({
            data: {
              userId,
              provider: 'simplefin',
              providerRef: mapped.providerRef,
              name: mapped.name,
              type: mapped.type,
              currentBalanceCents: mapped.currentBalanceCents,
            },
          })
        ).id;
    if (existingAcct) {
      // refresh the institution-authoritative balance/name on every sync
      await prisma.account.update({
        where: { id: accountId },
        data: { name: mapped.name, type: mapped.type, currentBalanceCents: mapped.currentBalanceCents },
      });
    }

    // Keep the account + balance (for net worth) but DON'T ingest a brokerage's
    // trades/dividends or a loan's interest as spending transactions (#62).
    if (mapped.type === 'INVESTMENT' || mapped.type === 'LOAN') continue;

    for (const txn of acct.transactions ?? []) {
      try {
        prepared.push(prepareSimplefinTransaction(txn, accountId, today, rules));
      } catch {
        continue; // malformed row (e.g. unparseable amount) — skip, don't abort the sync
      }
    }
  }

  // LLM-assist the rows the deterministic pipeline was unsure about — deduped per
  // descriptor, only the unknown long tail (DECISIONS #64). Provider is xAI/Grok
  // when XAI_API_KEY is set (cheaper), else Anthropic, else no-op → rows unchanged.
  const assisted = await assistUnsureRows(prepared, suggestCategoryViaLLM);

  // Pass 2: upsert transactions (idempotent on @@unique([accountId, providerRef])).
  for (const row of assisted) {
    const merchant = await prisma.merchant.upsert({
      where: { canonical: row.merchantCanonical },
      create: { canonical: row.merchantCanonical, defaultCategoryId: row.categoryId },
      update: {},
    });
    const data2 = {
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
    const exists = await prisma.transaction.findFirst({
      where: { accountId: row.accountId, providerRef: row.providerRef },
      select: { id: true },
    });
    await prisma.transaction.upsert({
      where: { accountId_providerRef: { accountId: row.accountId, providerRef: row.providerRef } },
      create: { accountId: row.accountId, providerRef: row.providerRef, ...data2 },
      update: data2,
    });
    if (exists) modified++;
    else added++;
  }

  // Cross-account transfer PAIRING (parity with Plaid; Hostile Critic CQ-5): the
  // pure detector flags opposite-amount pairs across the user's own accounts.
  // Only ADD flags (never unflag a descriptor-based transfer).
  const allTxns = await prisma.transaction.findMany({
    where: { account: { userId }, isSplitParent: false },
    select: { id: true, accountId: true, date: true, amountCents: true, rawDescriptor: true, isTransfer: true },
  });
  const flagged = detectTransfers(allTxns);
  const toFlag = allTxns.filter((t) => flagged.has(t.id) && !t.isTransfer).map((t) => t.id);
  if (toFlag.length) {
    await prisma.transaction.updateMany({ where: { id: { in: toFlag } }, data: { isTransfer: true } });
  }

  try {
    await refreshRecurringForUser(userId, today);
  } catch {
    // derived projection — never fail the sync over it
  }
  await prisma.simpleFinConnection.update({ where: { userId }, data: { lastSyncedAt: today } });
  return { added, modified, removed: 0, nextCursor: null };
}
