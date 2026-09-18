/** READ-ONLY: do the live 0977 Plaid items carry `ins_*`?
 * Critic P1-1 on O.20j residual (2): the prevention fold is conditional on
 * those ids. Prints provider / mask / item id / account stamp only — no
 * balances, no descriptors. */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const rows = await c.query<{
  provider: string;
  mask: string | null;
  type: string;
  account_ins: string | null;
  item_ins: string | null;
  has_item: boolean;
}>(
  `select a.provider, a.mask, a.type,
          a."institutionId" as account_ins,
          i."institutionId" as item_ins,
          (i."itemId" is not null) as has_item
     from "Account" a
     left join "PlaidItem" i
       on i."itemId" = a."plaidItemId" and i."userId" = a."userId"
    where a.mask = '0977' and a.type = 'CREDIT'
    order by a.provider, a."plaidItemId" nulls last`,
);
console.log(JSON.stringify(rows.rows, null, 2));
console.log('n=', rows.rows.length);
console.log(
  'plaid_missing_item_ins=',
  rows.rows.filter((r) => r.provider === 'plaid' && !r.item_ins).length,
);
console.log(
  'plaid_missing_both=',
  rows.rows.filter((r) => r.provider === 'plaid' && !r.item_ins && !r.account_ins).length,
);

await c.end();
