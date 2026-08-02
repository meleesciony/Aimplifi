/**
 * READ-ONLY follow-up to mortgage-replay (C.0): WHO paired with the two
 * transfer-flagged mortgage payments? The pair detector flags opposite-sign
 * same-|amount| rows within 3 days across accounts — find every row whose
 * |amount| is the mortgage payment and print its account, sign, and flag.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const rows = (
  await c.query(
    `select t.date, t."amountCents", t."rawDescriptor", t."categoryId", t."isTransfer",
            t.status, a.name as account, a.type as atype, a.provider
       from "Transaction" t join "Account" a on a.id = t."accountId"
      where a."userId" = (select "userId" from "Account" ac
                            join "Transaction" tx on tx."accountId" = ac.id
                           where tx."rawDescriptor" like 'TRUIST MORTG%' limit 1)
        and abs(t."amountCents") = 621707
      order by t.date`,
  )
).rows;
console.table(
  rows.map((r) => ({
    date: r.date,
    amount: (r.amountCents / 100).toFixed(2),
    account: `${r.account} (${r.atype}${r.provider ? '/' + r.provider : ''})`.slice(0, 44),
    categoryId: r.categoryId,
    isTransfer: r.isTransfer,
    status: r.status,
    descriptor: (r.rawDescriptor ?? '').slice(0, 40),
  })),
);
await c.end();
