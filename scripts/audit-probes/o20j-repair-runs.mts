/** READ-ONLY: has the owner-triggered transfer-flag repair ever run on prod, and
 *  what is the live flag population? One SELECT each; nothing written. */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const runs = await c.query(
  `select count(*)::int as n, max("createdAt")::text as last from "TransferFlagRepairRun"`,
);
console.log('repair runs:', JSON.stringify(runs.rows));

const flagged = await c.query(`select count(*)::int as n from "Transaction" where "isTransfer" = true`);
console.log('flagged rows:', JSON.stringify(flagged.rows));

const settledConverse = await c.query(
  `select count(*)::int as n from "Transaction" t join "Account" a on a.id = t."accountId"
   where t."isTransfer" = true and t."needsReview" = false and t.status = 'POSTED'
     and t."categoryId" is not null and t."categoryId" not in ('transfer','uncategorized','refund')
     and t."categoryId" not in (select id from "Category" where "group" = 'Income')`,
);
console.log('settled converse rows:', JSON.stringify(settledConverse.rows));

await c.end();
