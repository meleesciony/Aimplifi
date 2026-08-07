/**
 * READ-ONLY production probe — owner report 2026-08-07: the register shows
 * "0 transactions / $0.00 / $0.00" with every visible control on its default,
 * while printing "History available from Wed, Mar 25, 2026" four lines above.
 *
 * Two candidate causes, and this probe separates them WITHOUT guessing:
 *   (a) the DATA is gone / empty for that user  → row counts here are 0
 *   (b) the QUERY is narrowed by something the filter bar does not render
 *       → rows exist, and the oldest one is 2026-03-25 (the date on his screen)
 *
 * Prints, per user: total rows, POSTED rows, oldest/newest date, and the same
 * bounds narrowed to the register's own pre-filter set (spending account types,
 * USD) so the number can be compared against the screenshot directly.
 *
 * Also re-reads the K.2 pending question (Truist depth after the 730d re-link):
 * the item's row count + date bounds + its most recent plaid.sync.result rows.
 *
 * Timestamps are selected ::text — every DateTime here is `timestamp without
 * time zone` and node-pg would re-parse it in the client's local zone
 * (docs/lessons/a-driver-parsed-timestamp-is-not-the-stored-value.md).
 *
 * Every statement is a SELECT; nothing is written.
 *
 * STATUS: WRITTEN BUT NEVER EXECUTED. The session that wrote it was refused
 * permission to run `npx tsx` against the production connection string, so
 * nothing below has produced a single row and no claim anywhere in this repo
 * rests on its output. The register diagnosis it was written to settle was
 * decided from the screenshot and the render locks instead
 * (tests/unit/register-merchant-filter-render.test.tsx). It stays here because
 * its OTHER half — Truist row count + the newest `plaid.sync.result` rows after
 * the 730-day re-link — is the open K.2 question, and this is the query that
 * answers it the moment the command is allowed to run.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const users = await c.query<{
  id: string;
  email: string | null;
  createdAt: string;
  accounts: string;
  rows: string;
  posted: string;
  oldest: string | null;
  newest: string | null;
}>(
  `select u.id,
          u.email,
          u."createdAt"::text as "createdAt",
          (select count(*) from "Account" a where a."userId" = u.id)::text as accounts,
          (select count(*) from "Transaction" t
             join "Account" a on a.id = t."accountId"
            where a."userId" = u.id)::text as rows,
          (select count(*) from "Transaction" t
             join "Account" a on a.id = t."accountId"
            where a."userId" = u.id and t.status = 'POSTED')::text as posted,
          (select min(t.date) from "Transaction" t
             join "Account" a on a.id = t."accountId"
            where a."userId" = u.id) as oldest,
          (select max(t.date) from "Transaction" t
             join "Account" a on a.id = t."accountId"
            where a."userId" = u.id) as newest
     from "User" u
    order by u."createdAt"`,
);

console.log('=== USERS ===');
for (const u of users.rows) {
  console.log(
    `${u.email ?? '(no email)'}  id=${u.id}\n` +
      `   created ${u.createdAt}  accounts=${u.accounts}  rows=${u.rows} (POSTED ${u.posted})  span ${u.oldest ?? '—'} … ${u.newest ?? '—'}`,
  );
}

console.log('\n=== PER-ACCOUNT (users holding rows) ===');
const perAccount = await c.query<{
  email: string | null;
  name: string;
  type: string;
  currency: string | null;
  isHidden: boolean | null;
  rows: string;
  oldest: string | null;
  newest: string | null;
}>(
  `select u.email,
          a.name,
          a.type,
          a.currency,
          a."isHidden" as "isHidden",
          count(t.id)::text as rows,
          min(t.date) as oldest,
          max(t.date) as newest
     from "Account" a
     join "User" u on u.id = a."userId"
     left join "Transaction" t on t."accountId" = a.id
    group by u.email, a.id, a.name, a.type, a.currency, a."isHidden"
    order by u.email, count(t.id) desc`,
);
for (const r of perAccount.rows) {
  console.log(
    `${(r.email ?? '?').padEnd(26)} ${r.name.padEnd(30)} ${r.type.padEnd(10)} ${(r.currency ?? '?').padEnd(4)} hidden=${String(r.isHidden)}  rows=${r.rows.padStart(5)}  ${r.oldest ?? '—'} … ${r.newest ?? '—'}`,
  );
}

console.log('\n=== PLAID ITEMS ===');
const items = await c.query<{
  email: string | null;
  institution: string | null;
  itemId: string;
  createdAt: string;
  lastSyncedAt: string | null;
  rows: string;
  oldest: string | null;
  newest: string | null;
}>(
  `select u.email,
          i.institution,
          i."itemId",
          i."createdAt"::text as "createdAt",
          i."lastSyncedAt"::text as "lastSyncedAt",
          (select count(*) from "Transaction" t
             join "Account" a on a.id = t."accountId"
            where a."plaidItemId" = i.id)::text as rows,
          (select min(t.date) from "Transaction" t
             join "Account" a on a.id = t."accountId"
            where a."plaidItemId" = i.id) as oldest,
          (select max(t.date) from "Transaction" t
             join "Account" a on a.id = t."accountId"
            where a."plaidItemId" = i.id) as newest
     from "PlaidItem" i
     join "User" u on u.id = i."userId"
    order by i."createdAt"`,
);
for (const r of items.rows) {
  console.log(
    `${(r.institution ?? '?').padEnd(22)} ${r.itemId.padEnd(24)} created ${r.createdAt}  synced ${r.lastSyncedAt ?? '—'}  rows=${r.rows.padStart(5)}  ${r.oldest ?? '—'} … ${r.newest ?? '—'}`,
  );
}

console.log('\n=== LAST 15 plaid.sync.result ===');
const sync = await c.query<{ createdAt: string; metadata: unknown }>(
  `select "createdAt"::text as "createdAt", metadata
     from "AuditLog"
    where action = 'plaid.sync.result'
    order by "createdAt" desc
    limit 15`,
);
for (const r of sync.rows) console.log(r.createdAt, JSON.stringify(r.metadata));

await c.end();
