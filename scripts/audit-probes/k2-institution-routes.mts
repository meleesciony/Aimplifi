/**
 * READ-ONLY production probe — K.2: before telling the owner which history
 * route (SimpleFIN reconnect / fresh Plaid Link / CSV import) serves which of
 * his institutions, enumerate what each institution actually holds today.
 *
 * h1-connection-depth.mts answers "how deep is each CONNECTION". This answers
 * the question one level up: WHICH INSTITUTION is behind each bucket, so the
 * route table names banks the owner recognizes instead of item ids.
 *
 * Every statement is a SELECT; nothing is written.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const u = (
  await c.query<{ id: string }>(`select id from "User" where email = 'michael.lee.p@gmail.com'`)
).rows[0].id;

const cols = (
  await c.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_name = 'Account'`,
  )
).rows.map((r) => r.column_name);
console.log(`Account columns: ${cols.join(', ')}\n`);

console.log('--- SimpleFIN accounts ---');
const sf = await c.query<{
  name: string;
  type: string;
  n: string;
  mn: string | null;
  mx: string | null;
}>(
  `select a.name, a.type, count(t.id) as n, min(t.date) as mn, max(t.date) as mx
     from "Account" a left join "Transaction" t on t."accountId" = a.id
    where a."userId" = $1 and a.provider = 'simplefin'
    group by a.id, a.name, a.type order by a.name`,
  [u],
);
for (const r of sf.rows) {
  console.log(
    `  ${String(r.name).padEnd(38)} ${String(r.type).padEnd(10)} n=${String(r.n).padStart(4)} [${r.mn ?? '—'}..${r.mx ?? '—'}]`,
  );
}

console.log('\n--- Plaid items ---');
const pi = await c.query<Record<string, unknown>>(
  `select "itemId", institution, "createdAt", "lastSyncedAt", "historyBackfilledAt", status
     from "PlaidItem" where "userId" = $1 order by institution nulls last, "createdAt"`,
  [u],
);
for (const r of pi.rows) {
  console.log(
    `  ${String(r.institution ?? '?').padEnd(22)} item=${String(r.itemId).slice(0, 10)} ` +
      `created=${String(r.createdAt).slice(0, 10)} status=${r.status} backfill=${r.historyBackfilledAt ?? 'never'}`,
  );
}

console.log('\n--- Plaid accounts per item ---');
const pa = await c.query<{ institution: string | null; name: string; type: string; n: string; mn: string | null }>(
  `select i.institution, a.name, a.type, count(t.id) as n, min(t.date) as mn
     from "Account" a left join "PlaidItem" i on i."itemId" = a."plaidItemId"
     left join "Transaction" t on t."accountId" = a.id
    where a."userId" = $1 and a.provider = 'plaid'
    group by i.institution, a.id, a.name, a.type order by i.institution nulls last, a.name`,
  [u],
);
for (const r of pa.rows) {
  console.log(
    `  ${String(r.institution ?? '?').padEnd(22)} ${String(r.name).padEnd(34)} ${String(r.type).padEnd(10)} n=${String(r.n).padStart(4)} oldest=${r.mn ?? '—'}`,
  );
}

console.log('\n--- SimpleFinConnection rows ---');
console.log(
  (
    await c.query(
      `select id, "lastSyncedAt", "historyBackfilledAt", "createdAt" from "SimpleFinConnection" where "userId" = $1`,
      [u],
    )
  ).rows,
);

console.log('\n--- non-provider accounts ---');
console.log(
  (
    await c.query(`select name, provider, type from "Account" where "userId" = $1 and provider not in ('plaid','simplefin')`, [u])
  ).rows,
);

await c.end();
