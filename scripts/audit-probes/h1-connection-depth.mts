/**
 * READ-ONLY production probe — H.1(b): before building a per-connection
 * "history reaches back to <date>" line, measure what that line WOULD say on
 * the owner's live corpus, and whether the reconciliation boundary moves it.
 *
 * Why this is not a `groupBy _min`: the R1 keep rule
 * (`reconcile-boundary.ts:283 txnKeepRule`) is WINDOWED, not account-level. A
 * successor account loses exactly the rows inside its predecessor's claim
 * `[span.first, min(cutover, span.last)]` — which is a PREFIX of its history —
 * so its raw `min(date)` can be a row no register shows. Printing it would be
 * the H.8 defect (a rendered figure contradicting the register) one surface
 * further on.
 *
 * Questions this answers, before any code is designed:
 *   Q1  What does the register's own global earliest date say today (the number
 *       /transactions already prints as "History available from")?
 *   Q2  Per connection: raw earliest vs BOUNDARIED earliest, and the delta.
 *       A non-zero delta anywhere means the naive aggregate is unusable.
 *   Q3  Does any connection hold rows but own NONE of them (all claimed by a
 *       combine)? That case cannot render a date and needs its own copy.
 *   Q4  How many Plaid accounts carry a NULL `plaidItemId`? Those cannot be
 *       attributed to a connection at all, and the surface must say so rather
 *       than silently under-report a connection's depth.
 *   Q5  Does the global earliest come from an account belonging to NO
 *       connection (manual / CSV / disconnected-predecessor)? If so, a
 *       per-connection line is legitimately newer than the global one and the
 *       copy must not read as a claim about all history.
 *
 * Every statement is a SELECT; nothing is written.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { reconciliationTxnKeepFilter, effectiveReconciliationLinks } from '../../src/lib/engine/account/reconcile-boundary';
import { isSupportedCurrency } from '../../src/lib/providers/currency';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

interface Acc {
  id: string;
  name: string;
  type: string;
  provider: string;
  currency: string | null;
  currentBalanceCents: number | null;
  plaidItemId: string | null;
  userId: string;
}

const users = await c.query<{ id: string; email: string }>(
  `select distinct u.id, u.email from "User" u join "Account" a on a."userId" = u.id order by u.email`,
);

const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

for (const u of users.rows) {
  const accs = (
    await c.query<Acc>(
      `select id, name, type, provider, currency, "currentBalanceCents", "plaidItemId", "userId"
       from "Account" where "userId" = $1`,
      [u.id],
    )
  ).rows;
  if (accs.length === 0) continue;

  // The shipped keep-rule, built exactly as server/reconciliation.ts builds it.
  const links = (
    await c.query<{ predecessorAccountId: string; successorAccountId: string; cutoverDate: string }>(
      `select "predecessorAccountId", "successorAccountId", "cutoverDate"
       from "AccountReconciliation" where "userId" = $1 and "undoneAt" is null`,
      [u.id],
    )
  ).rows;
  const predSpans = (
    await c.query<{ accountId: string; first: string; last: string }>(
      `select "accountId", min(date) as first, max(date) as last from "Transaction"
       where "accountId" = any($1::text[]) group by "accountId"`,
      [links.map((l) => l.predecessorAccountId)],
    )
  ).rows;
  const supportedAccs = accs
    .filter((a) => isSupportedCurrency(a.currency))
    .map((a) => ({ ...a, currentBalanceCents: a.currentBalanceCents ?? 0 }));
  const keep = reconciliationTxnKeepFilter(supportedAccs, links, predSpans);
  const effective = effectiveReconciliationLinks(supportedAccs, links);

  // Every row, once. The register loads the same population before filtering.
  const rows = (
    await c.query<{ accountId: string; date: string }>(
      `select t."accountId", t.date from "Transaction" t join "Account" a on a.id = t."accountId"
       where a."userId" = $1 order by t.date asc`,
      [u.id],
    )
  ).rows;

  const accById = new Map(accs.map((a) => [a.id, a]));
  const supportedIds = new Set(supportedAccs.map((a) => a.id));

  // Q1 — the register's own global earliest: supported currencies, keep-filtered.
  let globalOwnedMin: string | null = null;
  let ownedTotal = 0;
  let globalOwnedMinAccount: string | null = null;
  for (const r of rows) {
    if (!supportedIds.has(r.accountId)) continue;
    if (!keep(r.accountId, r.date)) continue;
    ownedTotal += 1;
    if (globalOwnedMin === null || r.date < globalOwnedMin) {
      globalOwnedMin = r.date;
      globalOwnedMinAccount = r.accountId;
    }
  }

  const plaidItems = (
    await c.query<{
      id: string;
      itemId: string;
      institution: string | null;
      lastSyncedAt: string | null;
      historyBackfilledAt: string | null;
    }>(
      `select id, "itemId", institution, "lastSyncedAt", "historyBackfilledAt"
       from "PlaidItem" where "userId" = $1 order by "createdAt" asc`,
      [u.id],
    )
  ).rows;
  const sfConn = (
    await c.query<{ id: string; lastSyncedAt: string | null; historyBackfilledAt: string | null }>(
      `select id, "lastSyncedAt", "historyBackfilledAt" from "SimpleFinConnection" where "userId" = $1`,
      [u.id],
    )
  ).rows[0];

  // Group accounts into connection buckets exactly as a surface would have to.
  // `Account.plaidItemId` stores the PlaidItem's `itemId` (Plaid's own id string),
  // NOT the row's cuid — the shipped surface groups on exactly this equality
  // (`server/transactions.ts`: `a.plaidItemId === item.itemId`), so the probe must too.
  const bucketOf = (a: Acc): string => {
    if (a.provider === 'plaid') return a.plaidItemId ? `plaid:${a.plaidItemId}` : 'plaid:UNATTRIBUTED';
    if (a.provider === 'simplefin') return sfConn ? `simplefin:${sfConn.id}` : 'simplefin:NO-CONNECTION-ROW';
    return `none:${a.provider}`;
  };

  interface Bucket {
    rawMin: string | null;
    rawMax: string | null;
    rawRows: number;
    ownedMin: string | null;
    ownedMax: string | null;
    ownedRows: number;
    accounts: Set<string>;
  }
  const buckets = new Map<string, Bucket>();
  const bucketFor = (k: string): Bucket => {
    let b = buckets.get(k);
    if (!b) {
      b = { rawMin: null, rawMax: null, rawRows: 0, ownedMin: null, ownedMax: null, ownedRows: 0, accounts: new Set() };
      buckets.set(k, b);
    }
    return b;
  };
  for (const a of accs) bucketFor(bucketOf(a)).accounts.add(a.id);
  for (const r of rows) {
    const a = accById.get(r.accountId);
    if (!a || !supportedIds.has(a.id)) continue;
    const b = bucketFor(bucketOf(a));
    b.rawRows += 1;
    if (b.rawMin === null || r.date < b.rawMin) b.rawMin = r.date;
    if (b.rawMax === null || r.date > b.rawMax) b.rawMax = r.date;
    if (!keep(r.accountId, r.date)) continue;
    b.ownedRows += 1;
    if (b.ownedMin === null || r.date < b.ownedMin) b.ownedMin = r.date;
    if (b.ownedMax === null || r.date > b.ownedMax) b.ownedMax = r.date;
  }

  const label = (k: string): string => {
    if (k.startsWith('plaid:')) {
      const id = k.slice('plaid:'.length);
      const it = plaidItems.find((i) => i.itemId === id);
      return it ? `${it.institution ?? 'Connected bank'} (item ${it.itemId.slice(0, 8)}…)` : k;
    }
    return k;
  };

  console.log(`\n${'═'.repeat(78)}\nUSER ${u.email}`);
  console.log(
    `accounts=${accs.length} (supported=${supportedAccs.length})  rows=${rows.length}  ownedRows=${ownedTotal}  ` +
      `activeLinks=${links.length} (effective=${effective.length})`,
  );

  // Q1
  const gAcc = globalOwnedMinAccount ? accById.get(globalOwnedMinAccount) : undefined;
  console.log(
    `\nQ1  register global earliest (what /transactions prints): ${globalOwnedMin ?? 'NONE'}` +
      (gAcc ? `  ← ${gAcc.name} [${gAcc.provider}${gAcc.plaidItemId ? '' : ', no plaidItemId'}]` : ''),
  );

  // Q2 / Q3
  console.log(`\nQ2  per-connection depth (raw vs boundaried):`);
  const keys = [...buckets.keys()].sort();
  let anyDelta = false;
  for (const k of keys) {
    const b = buckets.get(k)!;
    const delta = b.rawMin && b.ownedMin ? dayDiff(b.rawMin, b.ownedMin) : null;
    if (delta !== null && delta !== 0) anyDelta = true;
    const it = k.startsWith('plaid:') ? plaidItems.find((i) => i.itemId === k.slice('plaid:'.length)) : undefined;
    console.log(
      `  ${label(k).padEnd(46)} accts=${String(b.accounts.size).padStart(2)}  ` +
        `raw=[${b.rawMin ?? '—'}..${b.rawMax ?? '—'}] n=${String(b.rawRows).padStart(4)}   ` +
        `owned=[${b.ownedMin ?? '—'}..${b.ownedMax ?? '—'}] n=${String(b.ownedRows).padStart(4)}   ` +
        `Δearliest=${delta === null ? 'n/a' : `${delta}d`}` +
        (it ? `   sync=${it.lastSyncedAt ?? 'never'} backfill=${it.historyBackfilledAt ?? 'never'}` : ''),
    );
    if (b.rawRows > 0 && b.ownedRows === 0) {
      console.log(`      ⚠ Q3 HIT — holds ${b.rawRows} rows and owns NONE: a date line here would be a fabrication.`);
    }
  }
  console.log(`  → Q2 verdict: ${anyDelta ? 'BOUNDARY MOVES at least one earliest date — the naive _min is WRONG' : 'no delta on this corpus today (protection, not repair)'}`);

  // Q4
  const unattributed = accs.filter((a) => a.provider === 'plaid' && !a.plaidItemId);
  console.log(
    `\nQ4  plaid accounts with NULL plaidItemId: ${unattributed.length} of ${accs.filter((a) => a.provider === 'plaid').length}` +
      (unattributed.length ? `  → ${unattributed.map((a) => a.name).join(', ')}` : ''),
  );

  // Q5
  const globalFromConnection = gAcc ? bucketOf(gAcc).startsWith('none:') === false : false;
  console.log(
    `\nQ5  global earliest belongs to ${gAcc ? bucketOf(gAcc) : 'nothing'} → ` +
      (globalFromConnection
        ? 'a connection; per-connection lines can equal the global one'
        : 'NO connection — every per-connection line will be NEWER than the global "History available from", so the copy must be scoped to the connection'),
  );
}

await c.end();
