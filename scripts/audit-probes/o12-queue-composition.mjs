/**
 * READ-ONLY production probe (TASKS O.12a). Re-measures the premise recorded in
 * the Wave O.12 diagnosis before any code is changed: how the owner's review
 * queue breaks down BY ACCOUNT TYPE, and how big the queue would be if it were
 * scoped the way every spending surface already scopes itself.
 *
 * A task row's premise is a hypothesis (lesson: sharing-a-basis-is-not-sharing-a-scope).
 * This one was measured last session; this re-runs it so the before/after number
 * the owner will see is produced in the same session as the fix.
 *
 * CREDENTIALS: reads `.env.prod.tmp` (gitignored). Delete it when done.
 * Usage: node scripts/audit-probes/o12-queue-composition.mjs
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const OWNER = 'cmqisanqh000004l7wylnhrpd';

function dbUrl() {
  const env = readFileSync('.env.prod.tmp', 'utf8');
  const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL missing from .env.prod.tmp');
  return line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
}

async function main() {
  const c = new pg.Client({ connectionString: dbUrl() });
  await c.connect();

  const byType = await c.query(
    `select a."type" as acct_type, count(*)::int as n
       from "Transaction" t join "Account" a on a.id = t."accountId"
      where a."userId" = $1 and t."needsReview" = true
      group by a."type" order by n desc`,
    [OWNER],
  );

  const total = await c.query(
    `select count(*)::int as n
       from "Transaction" t join "Account" a on a.id = t."accountId"
      where a."userId" = $1 and t."needsReview" = true`,
    [OWNER],
  );

  // Every account carrying queue rows, so nothing hides inside a type bucket.
  const byAccount = await c.query(
    `select a."name", a."type" as acct_type, a."subtype", count(*)::int as n
       from "Transaction" t join "Account" a on a.id = t."accountId"
      where a."userId" = $1 and t."needsReview" = true
      group by a."name", a."type", a."subtype" order by n desc`,
    [OWNER],
  );

  // Sample descriptors per type: proves the bucket is what its name says.
  const samples = await c.query(
    `select a."type" as acct_type, t."rawDescriptor"
       from "Transaction" t join "Account" a on a.id = t."accountId"
      where a."userId" = $1 and t."needsReview" = true
      order by a."type", t."date" desc`,
    [OWNER],
  );

  await c.end();

  console.log(`\nowner review-queue rows (needsReview=true): ${total.rows[0].n}\n`);
  console.table(byType.rows);
  console.log('\nby account:');
  console.table(byAccount.rows);

  const seen = new Map();
  for (const r of samples.rows) {
    const list = seen.get(r.acct_type) ?? [];
    if (list.length < 5) list.push(r.rawDescriptor);
    seen.set(r.acct_type, list);
  }
  console.log('\nsample descriptors per account type:');
  for (const [t, list] of seen) {
    console.log(`  ${t}:`);
    for (const d of list) console.log(`    ${d}`);
  }
}

void main();
