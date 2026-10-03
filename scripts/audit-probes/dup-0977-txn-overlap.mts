/** READ-ONLY (owner-authorized 2026-10-03): under the owner's active 0977 reconciliation link,
 * which transactions does each side keep, and do the kept sets overlap? */
import { readFileSync } from 'node:fs';
import pg from 'pg';
const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();
// Owner-scoped: abort unless exactly one user owns a 0977 row (critic P2-6) — never print a
// second user's accounts under the owner's authorization.
const owners0977 = (await c.query(`select distinct "userId" from "Account" where mask = '0977'`)).rows;
if (owners0977.length !== 1) { console.error(`expected exactly one 0977 owner, found ${owners0977.length} — aborting`); await c.end(); process.exit(1); }
const ownerId: string = owners0977[0].userId;
const link = (await c.query(
  `select r."predecessorAccountId" as pred, r."successorAccountId" as succ, r."cutoverDate" as cut
     from "AccountReconciliation" r join "Account" p on p.id = r."predecessorAccountId"
    where r."userId" = $1 and r."undoneAt" is null and p.mask = '0977'`,
  [ownerId],
)).rows;
if (link.length !== 1) { console.error(`expected exactly one active 0977 link, found ${link.length} — aborting`); await c.end(); process.exit(1); }
const { pred, succ, cut } = link[0] as { pred: string; succ: string; cut: string };
const q = async (label: string, sql: string, params: unknown[]) => {
  const r = await c.query(sql, params);
  console.log(`\n--- ${label}`);
  console.table(r.rows);
};
await q('rows per side of the cutover', `
  select case when "accountId"=$1 then 'pred' else 'succ' end as side,
         (date <= $3) as on_or_before_cut, count(*)::int n,
         sum("amountCents")::bigint as sum_cents, min(date) mn, max(date) mx
    from "Transaction" where "accountId" in ($1,$2) group by 1,2 order by 1,2`, [pred, succ, cut]);
await q('succ rows on/before cutover by month (dropped by the boundary)', `
  select substr(date,1,7) mon, count(*)::int n, sum("amountCents")::bigint s
    from "Transaction" where "accountId"=$1 and date <= $2 group by 1 order by 1`, [succ, cut]);
await q('same date+amount on both sides (whole history)', `
  select count(*)::int as matched_pairs from "Transaction" p join "Transaction" s
    on s."accountId"=$2 and s.date=p.date and s."amountCents"=p."amountCents" where p."accountId"=$1`, [pred, succ]);
await c.end();
