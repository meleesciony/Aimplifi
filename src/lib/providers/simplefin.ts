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
import { isUniqueViolation, prisma, serializableTx } from '@/lib/db';
import { isDemoUser } from '@/lib/demo-user';
import {
  type SimplefinBackfillSkipped,
  planSimplefinHistoryBackfill,
} from '@/lib/providers/simplefin-history-backfill';
import { refreshTransferFlags } from '@/lib/providers/transfer-refresh';
import { safeSyncErrorReason } from '@/lib/providers/sync-status';
import { assistUnsureRows } from '@/server/categorize-assist';
import { ensureCategories } from '@/server/ensure-categories';
import { categorizeSuggestFor } from '@/server/categorize-suggest';
import { loadUserRules } from '@/server/rules';
import { getThresholdTuning } from '@/server/tuning';
import { logCategoryPredictions } from '@/server/predictions';
import { refreshRecurringForUser } from '@/server/recurring';
import { activeSupersededPredecessorIds } from '@/server/reconciliation';
import {
  type IngestedSfTransaction,
  type SimplefinAccount,
  type SimplefinTransaction,
  mapSimplefinAccount,
  prepareSimplefinTransaction,
} from './simplefin-map';
import { type MappedSfHolding, mapSimplefinHoldings } from './simplefin-holdings';
import type { SyncResult } from './types';

/**
 * How much history the FIRST SimpleFIN pull asks for — and the backfill pull for
 * a spending account first seen on an incremental sync (DECISIONS #73).
 *
 * Owner request 2026-08-04: "why are we only pulling 6 months of data? Can we
 * get at least 2-3 years?" The answer for SimpleFIN was 90 days, chosen by
 * nobody — it was the original quick-start value and nobody ever revisited it
 * (the a-default-is-a-decision-you-shipped lesson, third instance after Plaid's
 * days_requested). The SimpleFIN bridge accepts an arbitrary start-date (epoch
 * seconds), so the honest window is "as far back as the INSTITUTION provides" —
 * some cap around 90 days, many carry years. Asking for three years and taking
 * whatever comes back costs one wider first fetch per connection and is bounded
 * by the bank, not by us. DECISIONS #61 (a start-date is always required) is
 * unchanged: this only widens the value we send.
 *
 * Deliberately NOT "all of time" (start-date 0): a few bridges reject or stall
 * on absurd windows, and three years is beyond every comparison the app makes
 * (the longest engine window is the FI signature's 12 months; the widest view a
 * reader can pick is 24 months of chart bars).
 */
export const SIMPLEFIN_INITIAL_LOOKBACK_DAYS = 1095;

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
 * Safety: POSTED rows are never touched here — institution-authoritative when the feed
 * owns them, and since O.15 slice 7 a POSTED row may also be one the READER marked
 * cleared by hand, which is a second reason not to touch it; a pending SPLIT
 * PARENT is protected from the in-window pass (one flaky snapshot must never destroy a
 * user decision — DECISIONS #148, cycle-4 #27) but DISSOLVES WITH its children in the
 * age-out pass (never orphaned, never immortal — the pre-#147 blanket exclusion made a
 * stale split double-count FOREVER after a new-id re-post; the bounded cost of the grace
 * window is the same ≤32d residual #128 already accepts); `providerRef: { not: null }`
 * scopes to feed-owned rows so manual/seed rows are never touched. No transaction has a
 * DB-level FK pointing at it (Correction / CategoryPrediction reference it by id string
 * only), so the delete can't FK-violate (orphaned analytics-log rows are harmless and
 * match the Plaid removed-path; STATUS).
 *
 * KNOWN BOUNDED RESIDUAL (accepted, DECISIONS #128 + #148): a hold that drifts past the
 * 5-day overlap and then re-posts under a NEW id can briefly double-count until the stale
 * pending ages out (≤ PENDING_MAX_AGE_DAYS, self-healing) — and a SPLIT pending whose
 * charge re-posts under a new id keeps its stale split (double count) for the same bounded
 * window before the age-out dissolves it. Eliminating either entirely would mean widening
 * the fetch window on every sync (churn/bandwidth) or destroying user splits on transient
 * feed noise — both rejected.
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
    // Only feed-owned rows: `not: null` excludes manual/seed rows. That guard is
    // LOAD-BEARING as of O.15 slice 7 — it used to be belt-and-braces because a
    // manual row was POSTED by construction and this pass only deletes PENDING
    // ones, and the reader can now mark his OWN row pending on a SimpleFIN-linked
    // account. Removing `not: null` would delete a transaction he typed. (The
    // premise of a carve-out dies when a new writer joins the column — the lesson
    // this repo recorded two days earlier, one column over.)
    // With refs returned, exclude the ones still present (notIn); an
    // empty set means the account returned nothing this sync, so every feed-owned
    // in-window pending row is now stale. (notIn:[] would match everything, so the
    // empty case drops the notIn and keeps only the not-null + window guards.)
    const staleWhere = {
      accountId,
      status: 'PENDING',
      date: { gte: startDate },
      providerRef: keep.length > 0 ? { notIn: keep, not: null } : { not: null },
    } as const;
    // Split parents are NOT swept in-window (cycle-4 #27, owner call): one transiently
    // flaky snapshot (or a garbled row — #26) must never destroy a user's split. A
    // genuinely re-posted/canceled split still heals in the pass-2 age-out below —
    // the ≤32d double-count is the SAME bounded residual #128 accepts for plain rows.
    // PINNED rows get the same in-window protection (cycle-5 confirmation P2): a
    // dissolve converts a sweep-protected split parent into a plain PENDING row —
    // deleting it on one flaky absence and re-creating it from the feed verdict
    // next sync would LAUNDER the pin (auto-filed, no user decision). Age-out
    // remains the backstop for both shapes.
    const { count } = await prisma.transaction.deleteMany({
      where: { ...staleWhere, isSplitParent: false, reviewPinned: false },
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
  const agedWhere = {
    account: { userId, provider: 'simplefin' },
    status: 'PENDING',
    date: { lt: ageOutFloor },
    providerRef: corroborated.length > 0 ? { notIn: corroborated, not: null } : { not: null },
  } as const;
  const agedOut = await serializableTx(async (tx) => {
    // Same split-parent dissolve as pass 1 (cycle-3 P0): an aged-out pending
    // split parent is a resolved-or-canceled charge — its children must not
    // keep counting phantom spending forever.
    const agedParents = await tx.transaction.findMany({
      where: { ...agedWhere, isSplitParent: true },
      select: { id: true },
    });
    if (agedParents.length > 0) {
      await tx.transaction.deleteMany({
        where: { splitParentId: { in: agedParents.map((p) => p.id) } },
      });
      await tx.transaction.deleteMany({ where: { id: { in: agedParents.map((p) => p.id) } } });
    }
    const { count } = await tx.transaction.deleteMany({
      where: { ...agedWhere, isSplitParent: false },
    });
    return count + agedParents.length;
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
  if (!conn) return { added: 0, modified: 0, removed: 0, nextCursor: null, derivedChanged: false };

  let result: SyncResult;
  try {
    result = await runSimplefinSync(conn, userId, today, opts);
  } catch (e) {
    // Gap 1 §4: persist a SANITIZED failure signal so the dashboard can honestly say
    // "reconnect". Never the raw error — it can carry the credential-bearing access URL
    // (#5). lastSyncedAt is left untouched (the last GOOD data still stands). Best-effort:
    // a failure recording that itself errors must not mask the original sync error.
    await prisma.simpleFinConnection
      .update({ where: { userId }, data: { lastSyncAttemptAt: today, lastSyncError: safeSyncErrorReason(e) } })
      .catch(() => {});
    throw e;
  }

  // Success bookkeeping runs OUTSIDE the failure-catch on purpose (Hostile Critic P2): the
  // ingest has already committed, so if THIS write blips it must never be re-read as a sync
  // failure and persist a false "broken" alert. Advance the last-good date and clear any
  // prior failure signal; a failure here propagates (pre-existing) and self-heals next sync.
  await prisma.simpleFinConnection.update({
    where: { userId },
    data: { lastSyncedAt: today, lastSyncAttemptAt: today, lastSyncError: null },
  });

  // One-time deep-history backfill (H.5). A connection whose first pull ran under
  // the old 90-day default is pinned to that floor forever — every later sync
  // starts at lastSyncedAt-5d — so its history cannot grow without this. Runs on
  // the connection's OWN success path (a failed sync never pays for it) and is
  // add-only and idempotent, so a failure here must never read as a sync failure:
  // the flag stays null, the next sync retries, and the audit row records why the
  // history is still short. A forced full pull (opts.fullLookbackDays) is already
  // as wide as the backfill, so it does the job itself — but the flag is still set
  // by the backfill's own path, never inferred here.
  if (!conn.historyBackfilledAt) {
    try {
      const hb = await backfillSimplefinHistory(conn, userId, today);
      result = {
        ...result,
        added: result.added + hb.added,
        // Rows landed that no engine has seen: recurring detection and transfer
        // pairing ran INSIDE runSimplefinSync, before these rows existed. The
        // backfill re-runs both (guarded) and reports the result, so the caller
        // re-renders (the whole point of three more years is that an annual or
        // semiannual series becomes detectable — H.2's note, made true here).
        derivedChanged: result.derivedChanged || hb.derivedChanged,
      };
    } catch (e) {
      await prisma.auditLog
        .create({
          data: {
            userId,
            action: 'simplefin.history-backfill.failed',
            // safeSyncErrorReason, not the raw message: this error came from a
            // fetch against the credential-bearing access URL (#5/SEC-SF-4), and
            // an audit row is stored text like any other.
            meta: JSON.stringify({ error: safeSyncErrorReason(e) }),
          },
        })
        .catch(() => {});
    }
  }
  return result;
}

/**
 * The one-time deep-history backfill for an EXISTING SimpleFIN connection (H.5).
 *
 * Deliberately NOT `syncFromSimplefin(userId, today, { fullLookbackDays: 1095 })`,
 * even though that parameter exists and was built for exactly this shape. A forced
 * full pull runs the whole live ingest over a three-year overlap, and that ingest
 * answers an already-stored row with `guardedVerdictRefresh` — which rewrites
 * categoryId / needsReview / isTransfer on every row the reader has not explicitly
 * corrected. On a 5-day overlap that is a refresh; over three years it is a silent
 * mass re-filing of the user's entire history against today's rules, moving every
 * report total with no user action behind it. It would also widen the #128 pending
 * reconcile's in-window pass from 5 days to 3 years. So this path plans first and
 * CREATES only rows that do not exist (simplefin-history-backfill.ts): add-only by
 * construction, not by intention.
 *
 * WHAT "ADD-ONLY" DOES AND DOES NOT COVER (critic cycle 1, A-P1-1). It covers every
 * Transaction row: this function calls `create` and never `update` or `delete`, so
 * no stored verdict, split, correction, amount or pending status can move. It does
 * NOT automatically extend to a DERIVED pass that rewrites existing rows — which is
 * why `refreshTransferFlags` is NOT called here even though the live sync calls it.
 * `transfer-refresh.ts` sets `isTransfer` on ALREADY-STORED rows when a newly added
 * row supplies a missing counterpart, and its pair rule is a coincidence detector
 * (equal magnitude, opposite sign, within 3 days) that would get three extra years
 * of chances to fire against rows the reader already settled — silently removing
 * them from every spending total. Transfer pairing therefore stays where the reader
 * can attribute it, the next ordinary sync, rather than arriving as a side effect of
 * a backfill nobody pressed a button for. `refreshRecurringForUser` IS called: it
 * writes only derived RecurringSeries/ScheduledTransaction rows, never a
 * Transaction, and re-deriving cadence is the entire reason more history is worth
 * having.
 *
 * BOUNDED PER RUN (critic cycle 1, B-P1-1/2/4). The ingest is chunked and capped: a
 * run commits as it goes and stops at BACKFILL_MAX_ROWS_PER_RUN, marking itself done
 * only once it has consumed the whole plan. A serverless timeout is not catchable,
 * so a run that dies must still leave progress behind — unchunked, a kill during the
 * LLM assist (which ran over the entire plan before the first create) committed
 * nothing, and the retry repeated the identical work forever.
 *
 * The institution caps what actually comes back — asking for 1095 days does not
 * mean receiving them. This reports what it added; it never promises three years.
 */
/** Rows one invocation will ingest before deferring the rest to the next sync. */
export const BACKFILL_MAX_ROWS_PER_RUN = 2000;
/** Rows per commit slice: the LLM assist and the creates both run per chunk, so a
 *  killed run loses at most this much work instead of all of it. */
export const BACKFILL_CHUNK_ROWS = 250;

async function backfillSimplefinHistory(
  conn: { accessUrl: string },
  userId: string,
  today: ISODate,
): Promise<{ added: number; derivedChanged: boolean; skipped: SimplefinBackfillSkipped }> {
  const noSkips: SimplefinBackfillSkipped = {
    pending: 0,
    unmappedAccount: 0,
    alreadyExists: 0,
    inconsistentFetch: 0,
    malformed: 0,
    undatable: 0,
  };
  // Demo fence (#242 F1, the categorizeSuggestFor stance): the shared demo row is
  // every anonymous visitor at once and must never trigger provider egress,
  // whatever route reaches this.
  if (isDemoUser(userId)) return { added: 0, derivedChanged: false, skipped: noSkips };

  const startDate = addDays(today, -SIMPLEFIN_INITIAL_LOOKBACK_DAYS);
  const data = await fetchSimplefinAccounts(decryptToken(conn.accessUrl), startDate);

  // Spending accounts ONLY, and only ones that already exist locally. The backfill
  // never creates an account: discovery belongs to the sync, which runs its own
  // first-seen full-history pass (DECISIONS #73) — and an account created here
  // would get its rows without ever passing through that pass's balance/holdings
  // handling. INVESTMENT and LOAN take no transaction rows on this path, matching
  // the sync's own two `continue`s.
  const localAccounts = await prisma.account.findMany({
    where: { userId, provider: 'simplefin', type: { in: ['CHECKING', 'SAVINGS', 'CREDIT'] } },
    select: { id: true, providerRef: true },
    orderBy: { id: 'asc' },
  });
  // A SUPERSEDED PREDECESSOR is read-only history and may not receive rows (critic
  // cycle 1, P0-1). `refuseManualWriteToSuperseded` already blocks manual entry and
  // CSV import onto these accounts; this is the same rule for a feed write, and the
  // reason is sharper than "the rows would be ignored". The boundary claims the
  // window [span.first, cutover] from the predecessor's FULL-HISTORY minimum date
  // (reconciliation.ts `getReconciliationTxnKeep` → reconcile-boundary.ts
  // `txnKeepRule`), and every SUCCESSOR row inside that window is dropped. Dragging
  // span.first back three years would therefore delete three years of the
  // successor's rows — the ones carrying the reader's corrections and splits — from
  // every figure, without updating a single row. Add-only is no defence against
  // that; not writing is.
  const superseded = await activeSupersededPredecessorIds([userId]);
  const accountIdByRef = new Map<string, string>();
  for (const a of localAccounts) {
    if (!a.providerRef || superseded.has(a.id)) continue;
    // FIRST wins, matching the sync's `findFirst` resolution (critic cycle 1,
    // P2-2): Account has no unique constraint on (userId, provider, providerRef),
    // and last-wins would file history onto a different row than the sync uses,
    // splitting one account's history in two. `orderBy: id` makes "first" stable.
    if (!accountIdByRef.has(a.providerRef)) accountIdByRef.set(a.providerRef, a.id);
  }

  // The add-only boundary. Scoped by `account.provider`, never a nullable join
  // column — the L.17 lesson the Plaid backfill already records.
  const existing = await prisma.transaction.findMany({
    where: { account: { userId, provider: 'simplefin' }, providerRef: { not: null } },
    select: { providerRef: true },
  });
  const existingRefs = new Set(existing.map((r) => r.providerRef as string));

  const accounts = data.accounts ?? [];
  const plan = planSimplefinHistoryBackfill(accounts, existingRefs, accountIdByRef);

  const markDone = () =>
    prisma.simpleFinConnection.update({ where: { userId }, data: { historyBackfilledAt: today } });
  const audit = (action: string, meta: Record<string, unknown>) =>
    prisma.auditLog.create({ data: { userId, action, meta: JSON.stringify(meta) } }).catch(() => {});

  // AN EMPTY PLAN IS NOT PROOF THAT THE HISTORY IS COMPLETE (critic cycle 1, P1-2).
  // A 200 carrying `errors` and no accounts, or a partial response that omits the
  // `transactions` array, produces the identical empty plan — and the planner
  // deliberately refuses to read a missing array as "no transactions". Marking done
  // on that would deny the reader the fix PERMANENTLY: the flag gates the only
  // trigger, and there is no user-facing way to ask for a retry. So a run counts as
  // done only when at least one MAPPED account actually reported an array;
  // anything else is audited as inconclusive and retried on the next sync.
  //
  // ZERO MAPPED ACCOUNTS is the one exception, and it is a real nothing-to-do rather
  // than a bad response: every SimpleFIN account is investment/loan, or superseded,
  // or not yet created locally. It marks done. Cycle 2 made this case retry instead,
  // on the grounds that supersession is reversible — which traded a permanent trap
  // for a permanent LOOP (a 1095-day fetch, a full providerRef scan and an audit row
  // on every sync, with nothing on this data able to end it). Reversibility now lives
  // where it belongs, as an EVENT: `undoReconciliationFor` clears
  // `historyBackfilledAt`, so undoing a combination re-arms the backfill. A terminal
  // state is safe once its reversal re-opens it.
  const reportedAny =
    accountIdByRef.size === 0 ||
    accounts.some((a) => Array.isArray(a.transactions) && accountIdByRef.has(a.id));
  if (!reportedAny) {
    await audit('simplefin.history-backfill.inconclusive', {
      windowStart: startDate,
      accountsReturned: accounts.length,
      mappedAccounts: accountIdByRef.size,
      // Read at last: the field is declared on the response type and nothing else
      // in this file consumes it, so a bridge-side error was previously invisible.
      errors: data.errors ?? [],
    });
    return { added: 0, derivedChanged: false, skipped: plan.skipped };
  }

  if (plan.rows.length === 0) {
    // A TRUSTWORTHY response with nothing to add — history already complete, or the
    // institution holds nothing older. Mark done so this is not refetched every
    // sync; the audit row keeps "ran, found nothing" distinct from "never ran".
    await markDone();
    await audit('simplefin.history-backfill', {
      windowStart: startDate,
      added: 0,
      deferredToNextSync: 0,
      complete: true,
      skipped: plan.skipped,
    });
    return { added: 0, derivedChanged: false, skipped: plan.skipped };
  }

  await ensureCategories(); // FK target for every txn.categoryId the categorizer emits (#63)
  const [rules, tuning] = await Promise.all([loadUserRules(userId), getThresholdTuning(userId)]);
  // Oldest first: a capped run should buy the reader the history he is actually
  // missing, and a partial run should extend the span DOWNWARD rather than leave a
  // hole in the middle. Sorted on the EFFECTIVE date — the one
  // `prepareSimplefinTransaction` will assign — not on `posted` alone (critic cycle
  // 3, P2-1). A row with the `posted: 0` sentinel
  // and a recent `transacted_at` survives the planner's undatable skip and would sort
  // to position 0 on raw `posted`, spending the cap's oldest-first budget on the
  // newest row in the plan; a feed omitting `posted` entirely would yield NaN and
  // scramble the order arbitrarily. `effectiveEpoch` cannot be 0 here: the planner
  // already dropped every row for which both fields are absent.
  const effectiveEpoch = (t: SimplefinTransaction) =>
    t.posted > 0 ? t.posted : (t.transacted_at ?? 0);
  const queued = [...plan.rows].sort((a, b) => effectiveEpoch(a.txn) - effectiveEpoch(b.txn));

  // The cap counts rows that could actually BE ingested, not rows examined (critic
  // cycle 2, P1-1). A row that throws in `prepareSimplefinTransaction` — an amount
  // the parser rejects — never reaches `create`, so it never enters `existingRefs`
  // and the next run re-plans it in the identical oldest-first position. Charging it
  // to the budget meant a bridge whose amount format this parser dislikes could hold
  // the cap forever: nothing lands, the flag never sets, and every sync pays a
  // three-year fetch until the connection dies. Unusable rows are therefore consumed
  // and discarded here, and only what CAN be prepared is rationed.
  let examined = 0;
  let budgetLeft = BACKFILL_MAX_ROWS_PER_RUN;
  let added = 0;
  let chunk: IngestedSfTransaction[] = [];

  const flush = async () => {
    // Per CHUNK, not per plan: `assistUnsureRows` fans out one concurrent LLM call
    // per distinct unsure descriptor with no internal cap, and its only previous
    // bound was that the live sync feeds it a 5-day window. Three years of
    // descriptors through one unbounded fan-out — before a single row is committed
    // — was both the cost spike and the reason a killed run made no progress.
    const assisted = await assistUnsureRows(chunk, categorizeSuggestFor(userId));
    chunk = [];

    // Each prepared row carries its OWN accountId, so the create loop never has to
    // index back into plan.rows — a prepare failure cannot misalign the pairing.
    for (const row of assisted) {
      const merchant = await prisma.merchant.upsert({
        where: { canonical: row.merchantCanonical },
        create: { canonical: row.merchantCanonical, defaultCategoryId: row.categoryId },
        update: {},
      });
      try {
        const createdRow = await prisma.transaction.create({
          data: {
            accountId: row.accountId,
            providerRef: row.providerRef,
            // Field-for-field the live sync's CREATE branch: a backfilled row must
            // be indistinguishable from one the sync delivered, because every
            // engine reads both.
            date: row.date,
            amountCents: row.amountCents,
            rawDescriptor: row.rawDescriptor,
            merchantId: merchant.id,
            status: row.status,
            categoryId: row.categoryId,
            confidenceBps: row.confidenceBps,
            needsReview: row.needsReview,
            isTransfer: row.isTransfer,
            ...(row.taxClassStamp ? { taxClass: row.taxClassStamp } : {}),
            ...(row.spendClassStamp ? { spendClassOverride: row.spendClassStamp } : {}),
          },
        });
        await logCategoryPredictions(userId, [
          {
            transactionId: createdRow.id,
            categoryId: row.categoryId,
            confidenceBps: row.confidenceBps,
            source: row.source,
          },
        ]);
        added++;
      } catch (e) {
        // The cron sweep and a hand-pressed Sync can race this: the loser lands on
        // @@unique(accountId, providerRef). The winner already stored the row, so
        // count it as existing rather than aborting the run (the live create path's
        // CQ-2 stance, reused).
        if (!isUniqueViolation(e)) throw e;
        plan.skipped.alreadyExists++;
      }
    }
  };

  for (const r of queued) {
    if (budgetLeft === 0) break;
    examined++;
    let row: IngestedSfTransaction;
    try {
      row = prepareSimplefinTransaction(r.txn, r.accountId, today, rules, tuning.flaggedBps);
    } catch {
      // Malformed row (e.g. unparseable amount) — skip it, exactly as the live ingest
      // does, never abort the run over one bad row, and DON'T charge it to the
      // budget: it can never be stored, so charging it would let it block the cap on
      // every future run.
      plan.skipped.malformed++;
      continue;
    }
    chunk.push(row);
    budgetLeft--;
    if (chunk.length >= BACKFILL_CHUNK_ROWS) await flush();
  }
  if (chunk.length > 0) await flush();
  const deferred = queued.length - examined;

  // Done ONLY when the WHOLE plan was consumed. A capped run leaves the flag null so
  // the next sync continues where this one stopped; `alreadyExists` makes that
  // continuation converge rather than duplicate. A crash mid-run behaves the same
  // way, which is the point of committing per chunk.
  if (deferred === 0) await markDone();
  await audit('simplefin.history-backfill', {
    windowStart: startDate,
    added,
    deferredToNextSync: deferred,
    complete: deferred === 0,
    skipped: plan.skipped,
  });

  // Cadence is the reason more history is worth having: an annual or semiannual
  // series needs occurrences the 90-day floor never stored. Guarded exactly as
  // inside runSimplefinSync — the ingest has already committed, so a throw in a
  // derived projection must not cost the caller a successful backfill. Transfer
  // pairing is deliberately NOT run here; see the docblock.
  let derivedChanged = false;
  if (added > 0) {
    try {
      const refreshed = await refreshRecurringForUser(userId, today);
      if (refreshed.changed) derivedChanged = true;
    } catch {
      // derived projection — never fail the backfill over it
    }
  }

  return { added, derivedChanged, skipped: plan.skipped };
}

async function runSimplefinSync(
  conn: { accessUrl: string; lastSyncedAt: string | null },
  userId: string,
  today: ISODate,
  opts: { fullLookbackDays?: number },
): Promise<SyncResult> {
  await ensureCategories(); // FK target for every txn.categoryId the categorizer emits (#63)
  const accessUrl = decryptToken(conn.accessUrl);
  const [rules, tuning] = await Promise.all([loadUserRules(userId), getThresholdTuning(userId)]);

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
      : addDays(today, -SIMPLEFIN_INITIAL_LOOKBACK_DAYS);
  const data = await fetchSimplefinAccounts(accessUrl, startDate);

  let added = 0;
  let modified = 0;
  let holdingsUpserted = 0;
  let holdingsRemoved = 0;
  let holdingsSkipped = 0;
  let holdingsWithheldNonUsd = 0;
  const prepared: IngestedSfTransaction[] = [];
  const accountIdByRef = new Map<string, string>();
  const newSpendingRefs: string[] = []; // first-seen spending accounts to backfill
  // Accounts whose transactions we actually fetched this run (existing spending
  // accounts + backfilled first-seen ones) — the scope of the pending reconcile.
  const syncedTxnAccountIds = new Set<string>();
  // EVERY id the feed returned per account — populated from the RAW rows before
  // parsing (cycle-4 #26), so a garbled-but-reported row still corroborates its
  // pending DB row and the reconcile never reads a parse failure as absence.
  const feedRefsByAccount = new Map<string, Set<string>>();

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
      // Corroborate the id from the RAW feed row, BEFORE parsing (cycle-4 #26): a
      // garbled row (unparseable amount) is skipped from ingest, but the feed still
      // REPORTED the id — treating it as absent let one transient parse failure feed
      // the reconcile a false staleness signal and sweep a still-real pending row.
      // Skip-ingest must never imply dissolve.
      if (typeof txn.id === 'string' && txn.id.length > 0) {
        let refs = feedRefsByAccount.get(accountId);
        if (!refs) {
          refs = new Set();
          feedRefsByAccount.set(accountId, refs);
        }
        refs.add(txn.id);
      }
      try {
        prepared.push(prepareSimplefinTransaction(txn, accountId, today, rules, tuning.flaggedBps));
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
        const { holdings, skipped, withheldNonUsd } = mapSimplefinHoldings(acct.holdings);
        holdingsWithheldNonUsd += withheldNonUsd; // counted once, independent of whether reconcile runs
        // A NON-EMPTY feed that mapped to ZERO positions is an anomaly (a format glitch,
        // or every position an unsupported type), NOT a sell-all — reconciling it would
        // WIPE the entire synced breakdown. Only reconcile when we have positions to write,
        // OR the feed was CLEANLY interpreted as all-foreign (every row WITHHELD as non-USD
        // and NONE un-mappable: withheldNonUsd > 0 && skipped === 0 — an all-foreign account
        // should prune its stale USD-valued rows, DECISIONS #156), OR the feed was EXPLICITLY
        // empty (a genuine sell-all); otherwise leave existing rows intact (counted as skipped).
        // The `skipped === 0` qualifier preserves the #133 guarantee for a MIXED feed (some
        // foreign + some un-mappable glitch): a garbled feed must NOT prune held rows just
        // because one row happened to read non-USD. Self-heals on the next clean sync.
        if (holdings.length > 0 || (withheldNonUsd > 0 && skipped === 0) || acct.holdings.length === 0) {
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
    // Same window as a first-ever pull: an account first seen mid-incremental
    // deserves the same history as one present from the start (DECISIONS #73).
    const backfill = await fetchSimplefinAccounts(accessUrl, addDays(today, -SIMPLEFIN_INITIAL_LOOKBACK_DAYS));
    for (const acct of backfill.accounts ?? []) {
      const accountId = accountIdByRef.get(acct.id);
      if (!accountId || !refs.has(acct.id)) continue;
      prepareAccountTxns(acct, accountId);
    }
  }

  // LLM-assist the rows the deterministic pipeline was unsure about — deduped per
  // descriptor, only the unknown long tail (DECISIONS #64). Provider is xAI/Grok
  // when XAI_API_KEY is set (cheaper), else Anthropic, else no-op → rows unchanged.
  // categorizeSuggestFor: demo fence (#242 F1 — a bank connected to the shared
  // demo account must not start egressing descriptors) + §3.2 audit sink.
  const assisted = await assistUnsureRows(prepared, categorizeSuggestFor(userId));

  // Pass 2: upsert transactions (idempotent on @@unique([accountId, providerRef])).
  for (const row of assisted) {
    const merchant = await prisma.merchant.upsert({
      where: { canonical: row.merchantCanonical },
      create: { canonical: row.merchantCanonical, defaultCategoryId: row.categoryId },
      update: {},
    });
    // Split: what the BANK knows (always refreshed) vs the category VERDICT (preserved
    // on user-settled rows — a user decision outranks the pipeline; the 5-day overlap
    // re-sends recently corrected rows every sync. Phase 3d + checker cycle 1:
    // isTransfer is part of the VERDICT, a split parent is never resurrected, and an
    // UNDONE row (corrections exist, back in review) takes the fresh verdict again.
    const base2 = {
      date: row.date,
      amountCents: row.amountCents,
      rawDescriptor: row.rawDescriptor,
      merchantId: merchant.id,
      status: row.status,
    };
    const data2 = {
      ...base2,
      categoryId: row.categoryId,
      confidenceBps: row.confidenceBps,
      needsReview: row.needsReview,
      isTransfer: row.isTransfer,
    };
    // Check-then-act at SERIALIZABLE isolation (cycle-2 P1): under production
    // Postgres READ COMMITTED a fileMerchantGroup/applyCategory committing between
    // the in-tx read and the write was still clobbered; Serializable turns that
    // into a detected conflict → P2034 → serializableTx re-runs against fresh
    // state (DECISIONS #146). SQLite: single-writer, unchanged.
    const guardedVerdictRefresh = (id: string) =>
      serializableTx(async (tx) => {
        const fresh = await tx.transaction.findUnique({
          where: { id },
          select: { isSplitParent: true, needsReview: true, amountCents: true, reviewPinned: true },
        });
        // Deleted in the window (an overlapping sync's reconcile / a dissolve) —
        // nothing to refresh. Throwing here aborted the WHOLE pass-2 loop
        // mid-run (cycle-3 P2): skip; the next sync re-evaluates.
        if (!fresh) return;
        if (fresh.isSplitParent && fresh.amountCents !== row.amountCents) {
          // The bank changed a SPLIT row's amount under the same id (pending
          // tip/adjustment posting): the children no longer sum to the charge, so
          // the split is stale — DISSOLVE it back to one row and FORCE it into
          // review (cycle-3 P1): a destroyed user decision always re-decides. The
          // pipeline's confidence — even the user's own merchant rule — does not
          // extend to a charge whose split the bank just broke; inheriting it
          // auto-filed the full amount SILENTLY, no triage card (DECISIONS #147).
          // reviewPinned makes the forced review DURABLE (cycle-4 P1): without it
          // the very next 5-day-overlap re-send saw an "undone-shaped" row and
          // re-applied the rule verdict one cron interval later (DECISIONS #148).
          await tx.transaction.deleteMany({ where: { splitParentId: id } });
          await tx.transaction.update({
            where: { id },
            data: { ...data2, isSplitParent: false, needsReview: true, confidenceBps: null, reviewPinned: true },
          });
          return;
        }
        const corrected =
          (await tx.correction.count({ where: { transactionId: id } })) > 0;
        // reviewPinned: a dissolve forced this row into review — the pin holds the
        // verdict (bank facts still refresh via base2) until a USER action clears it.
        const preserve =
          fresh.isSplitParent || fresh.reviewPinned || (corrected && !fresh.needsReview);
        await tx.transaction.update({ where: { id }, data: preserve ? base2 : data2 });
        if (fresh.isSplitParent) {
          // A preserved split POSTS with its parent: children stuck PENDING forever
          // would distort every pending projection (cycle-2 P0 family).
          await tx.transaction.updateMany({
            where: { splitParentId: id },
            data: { status: row.status },
          });
        }
      });
    const exists = await prisma.transaction.findFirst({
      where: { accountId: row.accountId, providerRef: row.providerRef },
      select: { id: true },
    });
    if (exists) {
      await guardedVerdictRefresh(exists.id);
      modified++;
    } else {
      try {
        const createdRow = await prisma.transaction.create({
          data: {
            accountId: row.accountId,
            providerRef: row.providerRef,
            ...data2,
            // O.15 slice 6: the rule's tag action, on the one path that creates a
            // row. `guardedVerdictRefresh` above deliberately does not tag — that
            // row already exists and its tag is the reader's.
            ...(row.taxClassStamp ? { taxClass: row.taxClassStamp } : {}),
            ...(row.spendClassStamp ? { spendClassOverride: row.spendClassStamp } : {}),
          },
        });
        // Log the pipeline's verdict for the accuracy metric + threshold tuning
        // (DECISIONS #190): the live-path counterpart of the seed's prediction log.
        await logCategoryPredictions(userId, [
          {
            transactionId: createdRow.id,
            categoryId: row.categoryId,
            confidenceBps: row.confidenceBps,
            source: row.source,
          },
        ]);
        added++;
      } catch (e) {
        // Cycle-2 P2 (the documented CQ-2 race, reopened when cycle 1 split the
        // race-safe upsert into findFirst+create to add the verdict guard): two
        // overlapping syncs both miss the findFirst; the loser lands here on
        // @@unique(accountId, providerRef) — take the guarded UPDATE path instead
        // of aborting the whole pass-2 loop mid-run.
        if (!isUniqueViolation(e)) throw e;
        const raced = await prisma.transaction.findFirst({
          where: { accountId: row.accountId, providerRef: row.providerRef },
          select: { id: true },
        });
        if (raced) {
          await guardedVerdictRefresh(raced.id);
          modified++;
        }
      }
    }
  }

  // Pending reconcile (DECISIONS #128): drop stale PENDING rows the feed no longer
  // reports within the fetched window — so a dropped or re-posted pending txn neither
  // lingers (overstating spend) nor double-counts. Build the returned-ref set per
  // account we synced (seed an empty set for every synced account so one that returned
  // nothing still has all its in-window pending rows reconciled away), then delete.
  // Runs BEFORE transfer pairing so a row about to be deleted is never paired.
  const returnedRefsByAccount = new Map<string, Set<string>>();
  for (const accountId of syncedTxnAccountIds) returnedRefsByAccount.set(accountId, new Set());
  // Corroboration = ids the feed RETURNED (raw, pre-parse — cycle-4 #26), a strict
  // superset of the ingested rows: a malformed row skips ingest but never signals
  // absence. `assisted` refs are folded in as belt-and-braces (identical by
  // construction for every row that parsed).
  for (const [accountId, refs] of feedRefsByAccount) {
    const target = returnedRefsByAccount.get(accountId);
    if (target) for (const ref of refs) target.add(ref);
  }
  for (const row of assisted) returnedRefsByAccount.get(row.accountId)?.add(row.providerRef);
  const pendingRemoved = await reconcilePendingTransactions(returnedRefsByAccount, startDate, userId, today);

  // Cross-account transfer PAIRING (parity with Plaid; Hostile Critic CQ-5):
  // shared helper — flags opposite-amount pairs across the user's own accounts
  // (only ever ADDING flags) and files still-in-review pairs as 'transfer' (#165).
  // GUARDED, like the recurring refresh below (critic P2-3): this runs after the ingest
  // has committed, so a throw here must not cost the caller a successful sync's counts.
  let derivedChanged = false;
  try {
    const transfers = await refreshTransferFlags(userId);
    // Same contract as the Plaid path: these are rows the guarded writes actually
    // mutated, so they are a change the reader can see and should re-render for.
    if (transfers.flagged + transfers.filed > 0) derivedChanged = true;
  } catch {
    // a derived re-classification; the ingest already succeeded
  }

  try {
    const refreshed = await refreshRecurringForUser(userId, today);
    if (refreshed.changed) derivedChanged = true;
  } catch {
    // derived projection — never fail the sync over it. A throw means the replace
    // transaction rolled back, so nothing changed and the flag stands as it is.
  }
  // Health bookkeeping (lastSyncedAt / lastSyncError) is done by the caller AFTER this
  // returns, so a bookkeeping-write blip is never misrecorded as a sync failure (see
  // syncFromSimplefin). This function's job ends at a committed ingest.
  return {
    added,
    modified,
    removed: pendingRemoved,
    nextCursor: null,
    holdings: { upserted: holdingsUpserted, removed: holdingsRemoved, skipped: holdingsSkipped, withheldNonUsd: holdingsWithheldNonUsd },
    derivedChanged,
  };
}
