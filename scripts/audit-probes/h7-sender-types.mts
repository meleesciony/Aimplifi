/**
 * READ-ONLY production probe — H.7: which account types actually SEND money on
 * the owner's corpus, and does any outflow sit on a type outside
 * `CAN_SEND_ACCOUNT_TYPES`? Every statement is a SELECT.
 *
 * The evidence bar refuses a pair whose outflow leg sits on a type that cannot
 * send. That is a claim about the owner's real accounts, so it is measured
 * rather than assumed — REAL_ESTATE accounts exist on this corpus, and a type
 * the set does not name is silently un-sendable.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { CAN_SEND_ACCOUNT_TYPES } from '../../src/lib/engine/categorize/transfers';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

const rows = await c.query<{ type: string; accounts: number; outflows: number; inflows: number }>(
  `select a.type,
          count(distinct a.id)::int as accounts,
          count(t.id) filter (where t."amountCents" < 0)::int as outflows,
          count(t.id) filter (where t."amountCents" > 0)::int as inflows
   from "Account" a
   left join "Transaction" t on t."accountId" = a.id and t."isSplitParent" = false
   group by a.type order by 3 desc nulls last`,
);

console.log('type            accounts  outflows  inflows   can send?');
for (const r of rows.rows) {
  const can = CAN_SEND_ACCOUNT_TYPES.has(r.type);
  const flag = !can && r.outflows > 0 ? '  <-- OUTFLOWS THAT CANNOT PAIR AS A SENDER' : '';
  console.log(
    `${r.type.padEnd(14)} ${String(r.accounts).padStart(8)} ${String(r.outflows).padStart(9)} ${String(
      r.inflows,
    ).padStart(8)}   ${can ? 'yes' : 'NO '}${flag}`,
  );
}

await c.end();
console.log('\ndone - read-only, nothing written.');
