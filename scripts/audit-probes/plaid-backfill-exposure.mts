/**
 * READ-ONLY production probe — Plaid deep-history backfill exposure
 * (H.5's open P1: the Plaid backfill on `main` since 18b6ad6 has no
 * superseded-predecessor filter; `undoReconciliationFor` does not re-arm it).
 *
 * Every statement is a SELECT. Nothing is written.
 *
 * Questions this answers, in order:
 *   1. Which PlaidItems exist, and has `historyBackfilledAt` been set (did the
 *      deployed backfill already run — the 11:00 UTC cron has fired since deploy)?
 *   2. What did the backfill audit rows record (added / skipped / failed)?
 *   3. Do ACTIVE reconciliations exist whose PREDECESSOR is a plaid account —
 *      and is that predecessor reachable by a LIVE item's fetch (same item
 *      still connected → its account_id maps → the defect can write to it)?
 *   4. History depth per provider right now (min/max txn date) — H.1(a) adjacent,
 *      and the before-picture for any later repair.
 *   5. SimpleFIN connection backfill state (did H.5's fix fire yet?).
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = readFileSync(new URL('../../.env.prod.tmp', import.meta.url), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))!;
const url = line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
const c = new pg.Client({ connectionString: url });
await c.connect();

// The owner = users with real linked plaid items (never the shared demo row).
const users = await c.query<{ id: string; email: string }>(
  `select distinct u.id, u.email from "User" u
   join "PlaidItem" p on p."userId" = u.id
   order by u.id asc`,
);
console.log(`users with plaid items: ${users.rows.length}`);

for (const user of users.rows) {
  console.log(`\n===== user ${user.id} <${user.email}> =====`);

  // 1. Items + backfill flags. Timestamps cast ::text — the driver would
  //    otherwise re-zone them (docs/lessons/a-driver-parsed-timestamp...).
  const items = await c.query(
    `select id, "itemId", institution, "historyBackfilledAt",
            "lastSyncedAt", "lastSyncError", "createdAt"::text as created
     from "PlaidItem" where "userId" = $1 order by "createdAt" asc`,
    [user.id],
  );
  console.log(`\n-- PlaidItems (${items.rows.length}) --`);
  for (const it of items.rows) {
    console.log(
      `item ${it.itemId?.slice(0, 12)}… inst=${it.institutionName ?? '?'} ` +
        `backfilledAt=${it.historyBackfilledAt ?? 'NULL'} lastSynced=${it.lastSyncedAt ?? 'never'} ` +
        `err=${it.lastSyncError ?? '-'} created=${it.created}`,
    );
  }

  // 2. Backfill audit rows, both providers.
  const audits = await c.query(
    `select action, meta, "createdAt"::text as at from "AuditLog"
     where "userId" = $1 and (action like 'plaid.item.history-backfill%' or action like 'simplefin.history-backfill%')
     order by "createdAt" asc`,
    [user.id],
  );
  console.log(`\n-- backfill audit rows (${audits.rows.length}) --`);
  for (const a of audits.rows) console.log(`${a.at}  ${a.action}  ${a.meta}`);

  // 3. Active reconciliations + each side's provider/item linkage.
  const recs = await c.query(
    `select r.id, r."predecessorAccountId", r."successorAccountId", r."cutoverDate", r."matchSignal",
            pa.provider as pred_provider, pa."plaidItemId" as pred_item, pa."providerRef" as pred_ref,
            pa.name as pred_name, pa.type as pred_type,
            sa.provider as succ_provider, sa."plaidItemId" as succ_item, sa.name as succ_name
     from "AccountReconciliation" r
     left join "Account" pa on pa.id = r."predecessorAccountId"
     left join "Account" sa on sa.id = r."successorAccountId"
     where r."userId" = $1 and r."undoneAt" is null`,
    [user.id],
  );
  console.log(`\n-- ACTIVE reconciliations (${recs.rows.length}) --`);
  for (const r of recs.rows) {
    console.log(
      `cutover=${r.cutoverDate} signal=${r.matchSignal}\n` +
        `  pred: ${r.pred_name ?? 'DELETED'} [${r.pred_provider ?? '-'}] type=${r.pred_type ?? '-'} item=${r.pred_item ?? 'NULL'} ref=${r.pred_ref ? String(r.pred_ref).slice(0, 10) + '…' : 'NULL'}\n` +
        `  succ: ${r.succ_name ?? 'DELETED'} [${r.succ_provider ?? '-'}] item=${r.succ_item ?? 'NULL'}`,
    );
    if (r.pred_provider === 'plaid') {
      // The defect's reach test: is the predecessor's providerRef served by an
      // item that still exists (its fetch would map rows onto the predecessor)?
      const live = await c.query(
        `select 1 from "PlaidItem" p where p."userId" = $1 and p.id = $2`,
        [user.id, r.pred_item],
      );
      const span = await c.query(
        `select min(date) as first, max(date) as last, count(*)::int as n
         from "Transaction" where "accountId" = $1`,
        [r.predecessorAccountId],
      );
      const droppable = await c.query(
        `select count(*)::int as n, coalesce(sum(case when "amountCents" < 0 then -"amountCents" else 0 end),0)::bigint as outflow
         from "Transaction"
         where "accountId" = $1 and date <= $2 and date >= coalesce($3, '0000-00-00')`,
        [r.successorAccountId, r.cutoverDate, span.rows[0].first],
      );
      console.log(
        `  >> plaid predecessor: own-item-still-connected=${live.rows.length > 0} ` +
          `pred span=[${span.rows[0].first}..${span.rows[0].last}] n=${span.rows[0].n}; ` +
          `successor rows inside [span.first..cutover] (dropped by boundary): n=${droppable.rows[0].n} outflowCents=${droppable.rows[0].outflow}`,
      );
    }
  }

  // 4. History depth per provider.
  const depth = await c.query(
    `select a.provider, min(t.date) as first, max(t.date) as last, count(*)::int as n
     from "Transaction" t join "Account" a on a.id = t."accountId"
     where a."userId" = $1 group by a.provider order by a.provider`,
    [user.id],
  );
  console.log(`\n-- history depth by provider --`);
  for (const d of depth.rows) console.log(`${d.provider}: [${d.first} .. ${d.last}] n=${d.n}`);

  // 5. SimpleFIN connection backfill state.
  const sf = await c.query(
    `select "historyBackfilledAt", "lastSyncedAt" from "SimpleFinConnection" where "userId" = $1`,
    [user.id],
  );
  for (const s of sf.rows) {
    console.log(`\n-- SimpleFinConnection: backfilledAt=${s.historyBackfilledAt ?? 'NULL'} lastSynced=${s.lastSyncedAt ?? 'never'}`);
  }
}

await c.end();
