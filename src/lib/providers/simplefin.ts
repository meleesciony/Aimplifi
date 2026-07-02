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
import { type MappedSfHolding, mapSimplefinHoldings } from './simplefin-holdings';
import type { SyncResult } from './types';

/**
 * Reconcile one INVESTMENT account's holdings against the brokerage feed
 * (DECISIONS #124). INVARIANT: a SimpleFIN sync touches ONLY its own
 * source='simplefin' rows — it NEVER modifies or deletes a source='manual' holding
 * the user entered by hand, even when the feed reports the same ticker (Hostile
 * Critic #124 P0: a symbol collision must not silently overwrite a user's
 * cost-basis). So we (1) skip any incoming position whose symbol is already a manual
 * holding on this account (counted, not written), (2) upsert the rest as
 * source='simplefin', and (3) delete stale source='simplefin' rows the feed no
 * longer reports (sold positions). Net worth is unaffected — the account's
 * currentBalanceCents (refreshed in Pass 1) stays authoritative; holdings are a
 * within-account breakdown. Resilient: a single position's DB error is counted, not
 * thrown, so it can't abort the whole sync.
 */
async function reconcileSimplefinHoldings(
  accountId: string,
  holdings: readonly MappedSfHolding[],
): Promise<{ upserted: number; removed: number; skipped: number }> {
  // Manual positions are user-owned and off-limits to the feed (upsert AND delete).
  const manualSymbols = new Set(
    (
      await prisma.holding.findMany({
        where: { accountId, source: 'manual' },
        select: { symbol: true },
      })
    ).map((h) => h.symbol),
  );

  let upserted = 0;
  let skipped = 0;
  for (const hld of holdings) {
    if (manualSymbols.has(hld.symbol)) {
      skipped++; // a manually-tracked ticker the feed also reports — leave the user's row intact
      continue;
    }
    const fields = {
      name: hld.name,
      quantity: hld.quantity,
      costBasisCents: hld.costBasisCents,
      priceCents: hld.priceCents,
      // The authoritative TOTAL market value (DECISIONS #129) — stored so the engine
      // reports the feed's real position value instead of reconstructing it from a
      // rounded per-share price (which loses low-price / high-quantity lots).
      marketValueCents: hld.marketValueCents,
      source: 'simplefin',
    };
    try {
      await prisma.holding.upsert({
        where: { accountId_symbol: { accountId, symbol: hld.symbol } },
        create: { accountId, symbol: hld.symbol, ...fields },
        update: fields,
      });
      upserted++;
    } catch {
      skipped++; // one position's write hiccup shouldn't lose the rest of the sync
    }
  }

  // Delete sold positions — ONLY our own synced rows (manual rows are never in scope).
  // An explicit empty feed means every previously-synced position is gone; notIn:[]
  // is avoided explicitly so the empty case is unambiguous.
  const syncedSymbols = holdings.filter((h) => !manualSymbols.has(h.symbol)).map((h) => h.symbol);
  const { count: removed } =
    syncedSymbols.length === 0
      ? await prisma.holding.deleteMany({ where: { accountId, source: 'simplefin' } })
      : await prisma.holding.deleteMany({
          where: { accountId, source: 'simplefin', symbol: { notIn: syncedSymbols } },
        });
  return { upserted, removed, skipped };
}

// A SimpleFIN "pending" authorization older than this has certainly resolved (posted or
// been dropped) — even the longest real holds (hotels, car rentals, fuel) clear well
// within a month. Past it we age out any feed-owned pending the CURRENT snapshot no longer
// corroborates, which is what catches multi-day holds that drift past the narrow
// incremental fetch window (DECISIONS #128, critic P1-1).
const PENDING_MAX_AGE_DAYS = 32;

/**
 * Pending-transaction reconcile (DECISIONS #128, live-ingest backlog #4). SimpleFIN
 * may DROP a pending transaction that never posts, or RE-POST it under a NEW id when
 * it clears (the spec permits the transaction id to change at post time). Without this
 * pass a stale pending row lingers (overstating spend — the cash-needed engine sums
 * pending), and a re-post under a new id is DOUBLE-COUNTED (old pending + new posted).
 * SimpleFIN sends no `removed[]` (it's a stateless per-window snapshot), so — like the
 * holdings reconcile and Plaid's removed-ids — we reconcile by ABSENCE, in two passes:
 *
 *   (1) IN-WINDOW: within the window we actually fetched (date >= startDate, so rows
 *       outside this query are never touched), for each account we synced this run delete
 *       PENDING rows whose providerRef the feed did NOT return. Handles the common case of
 *       a fast-posting/dropped pending inside the incremental overlap.
 *   (2) AGE-OUT: a feed-owned pending older than PENDING_MAX_AGE_DAYS has certainly
 *       resolved, so delete it regardless of which accounts appeared this sync — EXCLUDING
 *       anything the current snapshot still reports (so a corroborated long hold is safe).
 *       This is what reconciles a multi-day hold that drifted past the 5-day fetch window
 *       (absent from both the feed and pass 1) — without that, it would linger and, if it
 *       re-posted under a new id, double-count (critic P1-1).
 *
 * Safety: POSTED rows are institution-authoritative and never touched; split parents are
 * excluded so a user's split is never orphaned; `providerRef: { not: null }` scopes to
 * feed-owned rows so manual/seed rows are never touched. No transaction has a DB-level FK
 * pointing at it (Correction / CategoryPrediction reference it by id string only), so the
 * delete can't FK-violate (orphaned analytics-log rows are harmless and match the Plaid
 * removed-path; STATUS).
 *
 * KNOWN BOUNDED RESIDUAL (accepted, DECISIONS #128): a hold that drifts past the 5-day
 * overlap and then re-posts under a NEW id can briefly double-count until the stale pending
 * ages out (≤ PENDING_MAX_AGE_DAYS, self-healing). Eliminating it entirely would mean
 * widening the fetch window on every sync, which expands re-categorization churn and
 * bandwidth for a rare, self-correcting case.
 */
async function reconcilePendingTransactions(
  returnedRefsByAccount: ReadonlyMap<string, ReadonlySet<string>>,
  startDate: ISODate,
  userId: string,
  today: ISODate,
): Promise<number> {
  let removed = 0;
  // (1) In-window reconcile, per account we synced this run.
  for (const [accountId, refs] of returnedRefsByAccount) {
    const keep = [...refs];
    const { count } = await prisma.transaction.deleteMany({
      where: {
        accountId,
        status: 'PENDING',
        isSplitParent: false,
        date: { gte: startDate },
        // Only feed-owned rows: `not: null` excludes manual/seed rows (POSTED anyway,
        // but explicit). With refs returned, exclude the ones still present (notIn); an
        // empty set means the account returned nothing this sync, so every feed-owned
        // in-window pending row is now stale. (notIn:[] would match everything, so the
        // empty case drops the notIn and keeps only the not-null + window guards.)
        providerRef: keep.length > 0 ? { notIn: keep, not: null } : { not: null },
      },
    });
    removed += count;
  }
  // (2) Age-out across ALL of this user's SimpleFIN accounts (not just the ones synced this
  // run) — so an account transiently absent from the response still has its >32d-old
  // pendings (assumed resolved) swept; this self-heals if such a row is later re-reported.
  // `removed` cannot double-count even when a STALE incremental connection makes
  // startDate < ageOutFloor and the two passes' date ranges overlap: pass 1 physically
  // deletes and is awaited before pass 2 queries, and every deleteMany is account-scoped, so
  // each physical deletion is counted exactly once (the guarantee is sequential awaited
  // deletes, not date-disjointness). Excludes anything the current snapshot still reports as
  // pending (`corroborated`) so a real long hold is never deleted — the union is global, but
  // SimpleFIN transaction ids are globally unique so a cross-account ref collision can't
  // shield the wrong row.
  const ageOutFloor = addDays(today, -PENDING_MAX_AGE_DAYS);
  const corroborated = [...new Set([...returnedRefsByAccount.values()].flatMap((s) => [...s]))];
  const { count: agedOut } = await prisma.transaction.deleteMany({
    where: {
      account: { userId, provider: 'simplefin' },
      status: 'PENDING',
      isSplitParent: false,
      date: { lt: ageOutFloor },
      providerRef: corroborated.length > 0 ? { notIn: corroborated, not: null } : { not: null },
    },
  });
  return removed + agedOut;
}

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
export async function syncFromSimplefin(
  userId: string,
  today: ISODate,
  opts: { fullLookbackDays?: number } = {},
): Promise<SyncResult> {
  const conn = await prisma.simpleFinConnection.findUnique({ where: { userId } });
  if (!conn) return { added: 0, modified: 0, removed: 0, nextCursor: null };

  await ensureCategories(); // FK target for every txn.categoryId the categorizer emits (#63)
  const accessUrl = decryptToken(conn.accessUrl);
  const rules = await loadUserRules(userId);

  // Window: a forced full refresh (opts.fullLookbackDays) or the FIRST sync pulls
  // a wide history so the views aren't empty; incremental syncs overlap 5 days so
  // late-posting rows aren't missed (SimpleFIN returns nothing without a
  // start-date — DECISIONS #61). A "full pull" ingests every account directly;
  // an incremental pull additionally BACKFILLS accounts seen for the first time
  // on this sync (they'd otherwise only ever get the 5-day window and silently
  // miss all their history — the real-bank bug behind missing checking/card
  // expenses, DECISIONS #73).
  const forceFull = opts.fullLookbackDays != null;
  const isFullPull = forceFull || !conn.lastSyncedAt;
  const startDate = forceFull
    ? addDays(today, -opts.fullLookbackDays!)
    : conn.lastSyncedAt
      ? addDays(isoDate(conn.lastSyncedAt), -5)
      : addDays(today, -90);
  const data = await fetchSimplefinAccounts(accessUrl, startDate);

  let added = 0;
  let modified = 0;
  let holdingsUpserted = 0;
  let holdingsRemoved = 0;
  let holdingsSkipped = 0;
  const prepared: IngestedSfTransaction[] = [];
  const accountIdByRef = new Map<string, string>();
  const newSpendingRefs: string[] = []; // first-seen spending accounts to backfill
  // Accounts whose transactions we actually fetched this run (existing spending
  // accounts + backfilled first-seen ones) — the scope of the pending reconcile.
  const syncedTxnAccountIds = new Set<string>();

  const prepareAccountTxns = (acct: SimplefinAccount, accountId: string) => {
    // A MISSING transactions field (transient/partial response) must NOT be read as
    // "no transactions" — that would skip ingest AND wipe in-window pending rows.
    // Mirrors the #124 holdings guard; only an explicit array reconciles. `!arr` is
    // true for BOTH undefined and null (an untrusted feed can send `transactions: null`)
    // yet FALSE for an empty array, so an explicit [] still reconciles (critic P1-2:
    // the prior `=== undefined` let a null throw "not iterable" and abort the whole sync).
    if (!acct.transactions) return;
    syncedTxnAccountIds.add(accountId); // explicit [] still reconciles (an emptied window is real)
    for (const txn of acct.transactions) {
      try {
        prepared.push(prepareSimplefinTransaction(txn, accountId, today, rules));
      } catch {
        continue; // malformed row (e.g. unparseable amount) — skip, don't abort the sync
      }
    }
  };

  // Pass 1: upsert accounts + balances, and PREPARE spending-account rows.
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
              currency: mapped.currency,
            },
          })
        ).id;
    accountIdByRef.set(mapped.providerRef, accountId);
    if (existingAcct) {
      // refresh the institution-authoritative balance/name on every sync
      await prisma.account.update({
        where: { id: accountId },
        data: { name: mapped.name, type: mapped.type, currentBalanceCents: mapped.currentBalanceCents, currency: mapped.currency },
      });
    }

    // Keep the account + balance (for net worth) but DON'T ingest a brokerage's
    // trades/dividends or a loan's interest as spending transactions (#62). For an
    // INVESTMENT account, ingest its HOLDINGS (positions) instead — a within-account
    // breakdown for /investments; net worth stays on the account balance above (#124).
    if (mapped.type === 'INVESTMENT') {
      // Only reconcile when the feed ACTUALLY reports a holdings ARRAY (possibly
      // empty = "sold everything"). A MISSING, null, or otherwise non-array holdings
      // value from the untrusted feed must NOT be read as "no positions" — that would
      // wipe the synced breakdown (or, for a non-array, throw and abort the whole sync,
      // the `transactions: null` failure class from #128). `Array.isArray` routes all of
      // undefined/null/non-array to "leave existing rows untouched" (#124/#127 P2).
      if (Array.isArray(acct.holdings)) {
        const { holdings, skipped } = mapSimplefinHoldings(acct.holdings);
        // A NON-EMPTY feed that mapped to ZERO positions is an anomaly (a format glitch,
        // or every position an unsupported type), NOT a sell-all — reconciling it would
        // WIPE the entire synced breakdown. Only reconcile when we have positions to write
        // OR the feed was EXPLICITLY empty (a genuine sell-all); otherwise leave existing
        // rows intact (counted as skipped). Self-heals on the next sync that maps any
        // position — same conservative stance as the OMITTED-field guard above (#127 P2).
        if (holdings.length > 0 || acct.holdings.length === 0) {
          const rec = await reconcileSimplefinHoldings(accountId, holdings);
          holdingsUpserted += rec.upserted;
          holdingsRemoved += rec.removed;
          holdingsSkipped += skipped + rec.skipped;
        } else {
          holdingsSkipped += skipped; // nothing written, and crucially nothing DELETED
        }
      }
      continue;
    }
    if (mapped.type === 'LOAN') continue;

    // A spending account first seen on an INCREMENTAL sync has only the 5-day
    // window here — defer it to the backfill pass for its full history instead of
    // storing a partial slice (DECISIONS #73).
    if (!existingAcct && !isFullPull) {
      newSpendingRefs.push(mapped.providerRef);
      continue;
    }
    prepareAccountTxns(acct, accountId);
  }

  // Backfill pass: pull full history for spending accounts first seen on this
  // incremental sync, so their past transactions (older than the 5-day overlap)
  // are ingested — not just whatever happened to land in the last few days.
  if (newSpendingRefs.length > 0) {
    const refs = new Set(newSpendingRefs);
    const backfill = await fetchSimplefinAccounts(accessUrl, addDays(today, -90));
    for (const acct of backfill.accounts ?? []) {
      const accountId = accountIdByRef.get(acct.id);
      if (!accountId || !refs.has(acct.id)) continue;
      prepareAccountTxns(acct, accountId);
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
    // Split: what the BANK knows (always refreshed) vs the category VERDICT (preserved
    // on corrected rows — a user decision outranks the pipeline; the 5-day overlap
    // re-sends recently corrected rows every sync. Phase 3d, DIAGNOSIS item 4).
    const nonVerdict2 = {
      date: row.date,
      amountCents: row.amountCents,
      rawDescriptor: row.rawDescriptor,
      merchantId: merchant.id,
      status: row.status,
      isTransfer: row.isTransfer,
    };
    const data2 = {
      ...nonVerdict2,
      categoryId: row.categoryId,
      confidenceBps: row.confidenceBps,
      needsReview: row.needsReview,
    };
    const exists = await prisma.transaction.findFirst({
      where: { accountId: row.accountId, providerRef: row.providerRef },
      select: { id: true },
    });
    const corrected = exists
      ? (await prisma.correction.count({ where: { transactionId: exists.id } })) > 0
      : false;
    await prisma.transaction.upsert({
      where: { accountId_providerRef: { accountId: row.accountId, providerRef: row.providerRef } },
      create: { accountId: row.accountId, providerRef: row.providerRef, ...data2 },
      update: corrected ? nonVerdict2 : data2,
    });
    if (exists) modified++;
    else added++;
  }

  // Pending reconcile (DECISIONS #128): drop stale PENDING rows the feed no longer
  // reports within the fetched window — so a dropped or re-posted pending txn neither
  // lingers (overstating spend) nor double-counts. Build the returned-ref set per
  // account we synced (seed an empty set for every synced account so one that returned
  // nothing still has all its in-window pending rows reconciled away), then delete.
  // Runs BEFORE transfer pairing so a row about to be deleted is never paired.
  const returnedRefsByAccount = new Map<string, Set<string>>();
  for (const accountId of syncedTxnAccountIds) returnedRefsByAccount.set(accountId, new Set());
  for (const row of assisted) returnedRefsByAccount.get(row.accountId)?.add(row.providerRef);
  const pendingRemoved = await reconcilePendingTransactions(returnedRefsByAccount, startDate, userId, today);

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
  return {
    added,
    modified,
    removed: pendingRemoved,
    nextCursor: null,
    holdings: { upserted: holdingsUpserted, removed: holdingsRemoved, skipped: holdingsSkipped },
  };
}
